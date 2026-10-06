import { action, DidReceiveSettingsEvent, KeyDownEvent, SendToPluginEvent, SingletonAction, streamDeck, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { PlayerFeed } from "../player-feed";
import { addToPlaylist, fetchPlaylistEntries, hasUsableCookie, listPlaylists, parsePlaylistId, PlaylistEntry, removeFromPlaylist, YtmAuth, YtmError } from "../ytm-client";
import { BaseAction, BaseSettings } from "./base-action";
import { itemInfo } from "./queue-action";

// 押した時に、再生中の曲が既にプレイリストに入っていたらどうするか。
type WhenExisting =
	| "remove"  // プレイリストから外す(押すたびに追加/削除が切り替わる)
	| "keep"    // 何もしない
	| "add";    // もう1つ追加する

type AddToPlaylistSettings = BaseSettings & {
	playlistId?: string;      // 一覧(ドロップダウン)で選んだプレイリスト
	playlistName?: string;    // 選んだ時の表示名(一覧が読めない時の表示用)
	customPlaylist?: string;  // 共有リンク / ID を直接指定(こちらが優先)
	whenExisting?: WhenExisting;
	allowDuplicates?: boolean; // 旧設定(true なら "add" 扱い)
};

// 再生中の曲がプレイリストに入っているかの確認結果(context ごと)
type Membership = {
	key: string;         // "<playlistId>:<videoId>"
	contains?: boolean;  // 判定できなければ undefined
	checkedAt: number;
};

// プレイリストの中身(プレイリストごとに共有)
type PlaylistCache = {
	entries: PlaylistEntry[];
	fetchedAt: number;
};

// SendToPluginEvent の payload 型(SDK が JsonValue を再エクスポートしていないため)
type PluginMessage = Parameters<NonNullable<SingletonAction["onSendToPlugin"]>>[0]["payload"];

const PLAYLISTS_EVENT = "getPlaylists";
const RETRY_MS = 30_000;        // 確認に失敗した時に再挑戦するまで
const RECHECK_MS = 120_000;     // 同じ曲でも、アプリ側での追加・削除を拾うために見直す間隔
const CACHE_MS = 60_000;        // プレイリストの中身を使い回す時間(押下時は必ず読み直す)
const ERROR_BG = "#8E2F2F";
const DONE_BG = "#2F7D4F";

/**
 * 再生中の曲を、選んだ YouTube Music のプレイリストに追加する。既に入っていれば、設定に従って
 * 外す(既定)・何もしない・もう1つ足す。pear-desktop の API には無い操作なので、全体設定の
 * Cookie で YouTube Music に直接リクエストする。
 * キーは、再生中の曲が既にそのプレイリストに入っていればステート 1(緑)になる。
 */
@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.add-to-playlist" })
export class AddToPlaylistAction extends BaseAction<AddToPlaylistSettings> {
	private membership = new Map<string, Membership>();
	private playlists = new Map<string, PlaylistCache>();
	private aliases = new Map<string, Set<string>>();
	private busy = new Set<string>();

	protected override get needsPolling(): boolean {
		return true;
	}

	private targetPlaylist(settings: AddToPlaylistSettings): string | null {
		return parsePlaylistId(settings.customPlaylist) ?? parsePlaylistId(settings.playlistId);
	}

	private whenExisting(settings: AddToPlaylistSettings): WhenExisting {
		const value = settings.whenExisting;
		if (value === "remove" || value === "keep" || value === "add") {
			return value;
		}
		return settings.allowDuplicates ? "add" : "remove";
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<AddToPlaylistSettings>): void {
		super.onDidReceiveSettings(ev);
		this.membership.delete(ev.action.id);
	}

	override async onWillDisappear(ev: WillDisappearEvent<AddToPlaylistSettings>): Promise<void> {
		this.membership.delete(ev.action.id);
		await super.onWillDisappear(ev);
	}

	/**
	 * 同じ曲として扱う videoId の集合。YouTube Music では同じ曲に「曲(音声)」と「MV」の
	 * 2つの videoId があり、プレイリストにはどちらで入っていてもおかしくない。
	 * 再生中のキュー項目には切り替え先(counterpart)が載っているので、そこから取る。
	 */
	private async aliasesFor(port: string, videoId: string): Promise<Set<string>> {
		const cached = this.aliases.get(videoId);
		if (cached) {
			return cached;
		}
		const ids = new Set([videoId]);
		try {
			const queue = await this.get(port, "/queue");
			const items: any[] = Array.isArray(queue?.items) ? queue.items : [];
			const infos = items.map(itemInfo);
			const match = infos.find(info => info.selected && info.ids.has(videoId)) ?? infos.find(info => info.ids.has(videoId));
			match?.ids.forEach(id => ids.add(id));
		} catch {
			// キューが読めなければ再生中の videoId だけで判定する
		}
		if (this.aliases.size > 50) {
			this.aliases.clear();
		}
		this.aliases.set(videoId, ids);
		return ids;
	}

	private async entries(auth: YtmAuth, playlistId: string, maxAgeMs: number): Promise<PlaylistEntry[]> {
		const cached = this.playlists.get(playlistId);
		if (cached && Date.now() - cached.fetchedAt < maxAgeMs) {
			return cached.entries;
		}
		const entries = await fetchPlaylistEntries(auth, playlistId);
		this.playlists.set(playlistId, { entries, fetchedAt: Date.now() });
		return entries;
	}

	// 曲かプレイリストが変わった時(と、たまに)だけ、入っているかを確かめる。
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
		const age = known ? Date.now() - known.checkedAt : Infinity;
		if (known?.key === key && age < (known.contains === undefined ? RETRY_MS : RECHECK_MS)) {
			await this.applyState(ev.action, known.contains ? 1 : 0);
			return;
		}

		const entry: Membership = { key, contains: known?.key === key ? known.contains : undefined, checkedAt: Date.now() };
		this.membership.set(ev.action.id, entry);
		try {
			const ids = await this.aliasesFor(port, videoId);
			entry.contains = (await this.entries(auth, playlistId, CACHE_MS)).some(e => ids.has(e.videoId));
		} catch (error) {
			entry.contains = undefined;
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
		const remember = async (contains: boolean) => {
			this.membership.set(ev.action.id, { key, contains, checkedAt: Date.now() });
			await this.applyState(ev.action, contains ? 1 : 0);
		};
		try {
			// 押した時は必ず最新の中身で判定する(キャッシュや YouTube の重複スキップに頼らない)
			const ids = await this.aliasesFor(this.getPort(settings), videoId);
			const matches = (await this.entries(auth, playlistId, 0)).filter(e => ids.has(e.videoId));
			const mode = this.whenExisting(settings);

			if (matches.length > 0 && mode === "remove") {
				await removeFromPlaylist(auth, playlistId, matches);
				this.playlists.delete(playlistId);
				await remember(false);
				await this.flash(ev.action, ["Removed"]);
				return;
			}
			if (matches.length > 0 && mode === "keep") {
				await remember(true);
				await this.flash(ev.action, ["Already", "added"]);
				return;
			}

			const result = await addToPlaylist(auth, playlistId, videoId, mode === "add");
			this.playlists.delete(playlistId);
			await remember(true);
			if (result === "added") {
				await this.flash(ev.action, ["Added", settings.customPlaylist ? "" : settings.playlistName ?? ""], { color: DONE_BG });
			} else {
				await this.flash(ev.action, ["Already", "added"]);
			}
		} catch (error) {
			streamDeck.logger.error("Failed to update the playlist", error);
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
