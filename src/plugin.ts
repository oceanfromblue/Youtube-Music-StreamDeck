import streamDeck from "@elgato/streamdeck";

import { loadGlobalSettings } from "./global-settings";
import { AddPlaylistToQueueAction } from "./actions/add-playlist-to-queue";
import { AddToPlaylistAction } from "./actions/add-to-playlist";
import { LikeAction, DislikeAction } from "./actions/rate";
import { TogglePlayAction, NextAction, PreviousAction } from "./actions/playback";
import { ArtworkAction } from "./actions/artwork";
import { GoForwardAction, GoBackAction } from "./actions/go-forward-back";
import { SetVolumeAction, VolumeUpAction, VolumeDownAction, ToggleMuteAction } from "./actions/volume";
import { ShuffleAction, RepeatAction } from "./actions/modes";
import { VolumeDialAction, SeekDialAction } from "./actions/dials";

// "trace" は Stream Deck とのやり取りを全て記録する。アートワーク表示中は毎フレームの
// setImage(キー画像の data URI)まで残るためログが数分で数十MBに膨らむので、既定は "info"。
// プロトコルを追いたいときだけ一時的に "trace" に戻す。
streamDeck.logger.setLevel("info");

// Register the actions.
streamDeck.actions.registerAction(new AddPlaylistToQueueAction());
streamDeck.actions.registerAction(new AddToPlaylistAction());
streamDeck.actions.registerAction(new LikeAction());
streamDeck.actions.registerAction(new DislikeAction());
streamDeck.actions.registerAction(new TogglePlayAction());
streamDeck.actions.registerAction(new NextAction());
streamDeck.actions.registerAction(new PreviousAction());
streamDeck.actions.registerAction(new ArtworkAction());
streamDeck.actions.registerAction(new GoForwardAction());
streamDeck.actions.registerAction(new GoBackAction());
streamDeck.actions.registerAction(new SetVolumeAction());
streamDeck.actions.registerAction(new VolumeUpAction());
streamDeck.actions.registerAction(new VolumeDownAction());
streamDeck.actions.registerAction(new ToggleMuteAction());
streamDeck.actions.registerAction(new ShuffleAction());
streamDeck.actions.registerAction(new RepeatAction());
streamDeck.actions.registerAction(new VolumeDialAction());
streamDeck.actions.registerAction(new SeekDialAction());

// Initialize global settings (port, YouTube Music cookie).
void loadGlobalSettings();

// Finally, connect to the Stream Deck.
streamDeck.connect();
