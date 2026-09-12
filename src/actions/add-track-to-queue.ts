import { action, KeyDownEvent, streamDeck } from "@elgato/streamdeck";
import { BaseSettings } from "./base-action";
import { QueueAction } from "./queue-action";

type TrackSettings = BaseSettings & {
	videoId: string;
	forcePlay: boolean;
};

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.add-track-to-queue" })
export class AddTrackToQueueAction extends QueueAction<TrackSettings> {
	override async onKeyDown(ev: KeyDownEvent<TrackSettings>): Promise<void> {
		const { videoId, forcePlay } = ev.payload.settings;
		if (!videoId) {
			streamDeck.logger.warn("Video ID is not configured.");
			return;
		}

		try {
			await this.enqueue(this.getPort(ev.payload.settings), [videoId], !!forcePlay);
		} catch (error) {
			streamDeck.logger.error("Failed to add track to queue", error);
		}
	}
}
