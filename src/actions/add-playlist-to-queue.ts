import { action, KeyDownEvent, streamDeck } from "@elgato/streamdeck";
import { fetchPlaylistVideoIds, parsePlaylistId, YtmError } from "../ytm-client";
import { QueueAction, QueueSettings } from "./queue-action";

type PlaylistSettings = QueueSettings & {
	playlistId: string; // ID でも共有リンクでもよい
	shuffle: boolean;
};

const ERROR_BG = "#8E2F2F";

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.add-playlist-to-queue" })
export class AddPlaylistToQueueAction extends QueueAction<PlaylistSettings> {
	// 押下ごとに数秒かかるので、処理中の連打は無視する。
	private busy = new Set<string>();

	override async onKeyDown(ev: KeyDownEvent<PlaylistSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const playlistId = parsePlaylistId(settings.playlistId);
		if (!playlistId) {
			streamDeck.logger.warn("Playlist ID is not configured.");
			await this.flash(ev.action, ["No", "playlist"], { color: ERROR_BG });
			await ev.action.showAlert();
			return;
		}
		if (this.busy.has(ev.action.id)) {
			return;
		}
		this.busy.add(ev.action.id);

		try {
			await this.flash(ev.action, ["Loading…"], { ms: 60_000 });

			// 取得に失敗したら既存のキューには一切触らない。
			const ids = await fetchPlaylistVideoIds(playlistId, this.getYtmAuth());
			if (ids.length === 0) {
				streamDeck.logger.warn(`Playlist ${playlistId} has no playable tracks (is it private?).`);
				await this.flash(ev.action, ["Playlist", "not found"], { color: ERROR_BG });
				await ev.action.showAlert();
				return;
			}

			const tracks = settings.shuffle ? this.shuffleArray(ids) : ids;
			const result = await this.enqueue(this.getPort(settings), tracks, this.queueMode(settings));
			if (result.added === 0) {
				await this.flash(ev.action, ["Queue", "failed"], { color: ERROR_BG });
				await ev.action.showAlert();
				return;
			}
			await this.flash(ev.action, ["Queued", `${result.added} songs`]);
		} catch (error) {
			streamDeck.logger.error("Failed to add playlist to queue", error);
			const offline = error instanceof YtmError && error.kind === "network";
			await this.flash(ev.action, offline ? ["No", "connection"] : ["Failed"], { color: ERROR_BG });
			await ev.action.showAlert();
		} finally {
			this.busy.delete(ev.action.id);
		}
	}

	private shuffleArray<T>(array: T[]): T[] {
		const newArray = [...array];
		for (let i = newArray.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[newArray[i], newArray[j]] = [newArray[j], newArray[i]];
		}
		return newArray;
	}
}
