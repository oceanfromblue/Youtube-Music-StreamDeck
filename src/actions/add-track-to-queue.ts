import { action, KeyDownEvent, streamDeck } from "@elgato/streamdeck";
import { QueueAction, QueueSettings } from "./queue-action";

type TrackSettings = QueueSettings & {
	videoId: string;
};

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.add-track-to-queue" })
export class AddTrackToQueueAction extends QueueAction<TrackSettings> {
	override async onKeyDown(ev: KeyDownEvent<TrackSettings>): Promise<void> {
		const settings = ev.payload.settings;
		if (!settings.videoId) {
			streamDeck.logger.warn("Video ID is not configured.");
			return;
		}

		try {
			await this.enqueue(this.getPort(settings), [settings.videoId], this.queueMode(settings));
		} catch (error) {
			streamDeck.logger.error("Failed to add track to queue", error);
		}
	}
}
