import streamDeck from "@elgato/streamdeck";

import { AddTrackToQueueAction } from "./actions/add-track-to-queue";
import { AddPlaylistToQueueAction } from "./actions/add-playlist-to-queue";
import { LikeAction, DislikeAction } from "./actions/rate";
import { TogglePlayAction, NextAction, PreviousAction } from "./actions/playback";
import { ArtworkAction } from "./actions/artwork";
import { GoForwardAction, GoBackAction } from "./actions/go-forward-back";
import { SetVolumeAction } from "./actions/volume";

// "trace" は Stream Deck とのやり取りを全て記録する。アートワーク表示中は毎フレームの
// setImage(キー画像の data URI)まで残るためログが数分で数十MBに膨らむので、既定は "info"。
// プロトコルを追いたいときだけ一時的に "trace" に戻す。
streamDeck.logger.setLevel("info");

// Register the increment action.
streamDeck.actions.registerAction(new AddTrackToQueueAction());
streamDeck.actions.registerAction(new AddPlaylistToQueueAction());
streamDeck.actions.registerAction(new LikeAction());
streamDeck.actions.registerAction(new DislikeAction());
streamDeck.actions.registerAction(new TogglePlayAction());
streamDeck.actions.registerAction(new NextAction());
streamDeck.actions.registerAction(new PreviousAction());
streamDeck.actions.registerAction(new ArtworkAction());
streamDeck.actions.registerAction(new GoForwardAction());
streamDeck.actions.registerAction(new GoBackAction());
streamDeck.actions.registerAction(new SetVolumeAction());

// Initialize global settings.
streamDeck.settings.getGlobalSettings<{ port?: string }>().then(settings => {
	if (settings === undefined || settings.port === undefined) {
		streamDeck.settings.setGlobalSettings({ port: "26538" });
	}
});

// Finally, connect to the Stream Deck.
streamDeck.connect();
