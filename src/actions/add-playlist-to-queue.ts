import { action, KeyDownEvent, streamDeck } from "@elgato/streamdeck";
import YouTubeMusic from "youtube-music-ts-api";
import { QueueAction, QueueSettings } from "./queue-action";

type PlaylistSettings = QueueSettings & {
	playlistId: string;
	shuffle: boolean;
};

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.add-playlist-to-queue" })
export class AddPlaylistToQueueAction extends QueueAction<PlaylistSettings> {
	override async onKeyDown(ev: KeyDownEvent<PlaylistSettings>): Promise<void> {
		const settings = ev.payload.settings;
		if (!settings.playlistId) {
			streamDeck.logger.warn("Playlist ID is not configured.");
			return;
		}

		try {
			// ゲストモードで取得する。取得に失敗した場合に既存のキューを消してしまわないよう、
			// enqueue(= replace 時の DELETE)はプレイリストが取れてから呼ぶ。
			const guest = await new YouTubeMusic().guest();
			const playlist = await guest.getPlaylist(settings.playlistId);
			if (!playlist?.tracks) {
				return;
			}

			const tracks = settings.shuffle ? this.shuffleArray(playlist.tracks) : playlist.tracks;
			const videoIds = tracks.map(track => track.id).filter((id): id is string => !!id);
			await this.enqueue(this.getPort(settings), videoIds, this.queueMode(settings));
		} catch (error) {
			streamDeck.logger.error("Failed to add playlist to queue", error);
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
