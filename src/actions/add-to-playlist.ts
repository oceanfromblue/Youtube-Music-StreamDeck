import { action, DidReceiveSettingsEvent, KeyDownEvent, SendToPluginEvent, SingletonAction, streamDeck, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { PlayerFeed } from "../player-feed";
import { addToPlaylist, hasUsableCookie, listPlaylists, parsePlaylistId, playlistContains, YtmError } from "../ytm-client";
import { BaseAction, BaseSettings } from "./base-action";

type AddToPlaylistSettings = BaseSettings & {
	playlistId?: string;      // 一覧(ドロップダウン)で選んだプレイリスト
	playlistName?: string;    // 選んだ時の表示名(一覧が読めない時の表示用)
	customPlaylist?: string;  // 共有リンク / ID を直接指定(こちらが優先)
	allowDuplicates?: boolean;
};

// 再生中の曲がプレイリストに入っているかの確認結果(context ごと)
type Membership = {
	key: string;         // "<playlistId>:<videoId>"
	contains?: boolean;  // 判定できなければ undefined
	checkedAt: number;
};

// SendToPluginEvent の payload 型(SDK が JsonValue を再エクスポートしていないため)
type PluginMessage = Parameters<NonNullable<SingletonAction["onSendToPlugin"]>>[0]["payload"];

const PLAYLISTS_EVENT = "getPlaylists";
const RETRY_MS = 30_000;
const ERROR_BG = "#8E2F2F";
const DONE_BG = "#2F7D4F";

/**
 * 再生中の曲を、選んだ YouTube Music のプレイリストに追加する。
 * pear-desktop の API には無い操作なので、全体設定の Cookie で YouTube Music に直接リクエストする。
 * キーは、再生中の曲が既にそのプレイリストに入っていればステート 1(緑)になる。
 */
@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.add-to-playlist" })
export class AddToPlaylistAction extends BaseAction<AddToPlaylistSettings> {
	private membership = new Map<string, Membership>();
	private busy = new Set<string>();

	protected override get needsPolling(): boolean {
		return true;
	}

	private targetPlaylist(settings: AddToPlaylistSettings): string | null {
		return parsePlaylistId(settings.customPlaylist) ?? parsePlaylistId(settings.playlistId);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<AddToPlaylistSettings>): void {
		super.onDidReceiveSettings(ev);
		this.membership.delete(ev.action.id);
	}

	override async onWillDisappear(ev: WillDisappearEvent<AddToPlaylistSettings>): Promise<void> {
		this.membership.delete(ev.action.id);
		await super.onWillDisappear(ev);
	}

	// 曲かプレイリストが変わった時だけ、入っているかを YouTube Music に問い合わせる。
	protected override async onPoll(ev: WillAppearEvent<AddToPlaylistSettings>, port: string, feed: PlayerFeed, settings: AddToPlaylistSettings): Promise<void> {
		const auth = this.getYtmAuth();
		const playlistId = this.targetPlaylist(settings);
		const videoId = feed.current()?.videoId;
		if (!hasUsableCookie(auth) || !playlistId || !videoId) {
			await this.applyState(ev.action, 0);
			return;
		}

		const key = `${playlistId}:${videoId}`;
		const known = this.membership.get(ev.action.id);
		if (known?.key === key && (known.contains !== undefined || Date.now() - known.checkedAt < RETRY_MS)) {
			await this.applyState(ev.action, known.contains ? 1 : 0);
			return;
		}

		const entry: Membership = { key, checkedAt: Date.now() };
		this.membership.set(ev.action.id, entry);
		try {
			entry.contains = await playlistContains(auth, playlistId, videoId);
		} catch (error) {
			streamDeck.logger.debug("Could not check the playlist membership", error);
		}
		if (this.membership.get(ev.action.id) === entry) {
			await this.applyState(ev.action, entry.contains ? 1 : 0);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<AddToPlaylistSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const auth = this.getYtmAuth();
		if (!hasUsableCookie(auth)) {
			await this.flash(ev.action, ["Set cookie", "in settings"], { color: ERROR_BG });
			await ev.action.showAlert();
			return;
		}
		const playlistId = this.targetPlaylist(settings);
		if (!playlistId) {
			await this.flash(ev.action, ["Choose a", "playlist"], { color: ERROR_BG });
			await ev.action.showAlert();
			return;
		}
		const videoId = (await this.currentSong(settings))?.videoId;
		if (!videoId) {
			await this.flash(ev.action, ["Nothing", "playing"], { color: ERROR_BG });
			await ev.action.showAlert();
			return;
		}
		if (this.busy.has(ev.action.id)) {
			return;
		}
		this.busy.add(ev.action.id);

		const key = `${playlistId}:${videoId}`;
		try {
			const allowDuplicates = !!settings.allowDuplicates;
			const known = this.membership.get(ev.action.id);
			const result = !allowDuplicates && known?.key === key && known.contains
				? "duplicate"
				: await addToPlaylist(auth, playlistId, videoId, allowDuplicates);

			this.membership.set(ev.action.id, { key, contains: true, checkedAt: Date.now() });
			await this.applyState(ev.action, 1);
			if (result === "added") {
				await this.flash(ev.action, ["Added", settings.customPlaylist ? "" : settings.playlistName ?? ""], { color: DONE_BG });
			} else {
				await this.flash(ev.action, ["Already", "added"]);
			}
		} catch (error) {
			streamDeck.logger.error("Failed to add the song to the playlist", error);
			const kind = error instanceof YtmError ? error.kind : "api";
			const lines = kind === "auth" ? ["Cookie", "expired?"] : kind === "network" ? ["No", "connection"] : ["Failed"];
			await this.flash(ev.action, lines, { color: ERROR_BG });
			await ev.action.showAlert();
		} finally {
			this.busy.delete(ev.action.id);
		}
	}

	// Property Inspector のドロップダウン(sdpi-select の datasource)にプレイリスト一覧を返す。
	override async onSendToPlugin(ev: SendToPluginEvent<PluginMessage, AddToPlaylistSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event !== PLAYLISTS_EVENT) {
			return;
		}

		let items: { label: string; value: string; disabled?: boolean }[];
		const auth = this.getYtmAuth();
		if (!hasUsableCookie(auth)) {
			items = [{ label: "Paste your cookie below first", value: "", disabled: true }];
		} else {
			try {
				const settings = await ev.action.getSettings();
				const videoId = (await this.currentSong(settings))?.videoId;
				const playlists = await listPlaylists(auth, videoId);
				items = playlists.length > 0
					? playlists.map(p => ({ label: p.title, value: p.id }))
					: [{ label: "No playlists found", value: "", disabled: true }];
			} catch (error) {
				streamDeck.logger.warn("Could not load playlists", error);
				const reason = error instanceof YtmError && error.kind === "auth" ? "cookie rejected" : "see logs";
				items = [{ label: `Could not load playlists (${reason})`, value: "", disabled: true }];
			}
		}
		await streamDeck.ui.sendToPropertyInspector({ event: PLAYLISTS_EVENT, items });
	}
}
