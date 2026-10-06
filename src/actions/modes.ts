import { action, KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";
import { readFileSync } from "node:fs";
import { PlayerFeed, RepeatMode } from "../player-feed";
import { BaseAction, BaseSettings } from "./base-action";

// プラグインフォルダ内の PNG を data URI で読む(bin/plugin.js から見た相対パス)。
function loadImage(path: string): string | undefined {
	try {
		return `data:image/png;base64,${readFileSync(new URL(`../${path}`, import.meta.url)).toString("base64")}`;
	} catch {
		return undefined;
	}
}

/**
 * シャッフルの切り替え。シャッフル中はキーがステート 1 になる。
 */
@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.shuffle" })
export class ShuffleAction extends BaseAction<BaseSettings> {
	protected override get needsPolling(): boolean {
		return true;
	}

	protected override async onPoll(ev: WillAppearEvent<BaseSettings>, port: string, feed: PlayerFeed): Promise<void> {
		const shuffle = feed.shuffle ?? (feed.live ? undefined : (await this.get(port, "/shuffle"))?.state);
		await this.applyState(ev.action, shuffle ? 1 : 0);
	}

	override async onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		await this.send(ev, "/shuffle");
	}
}

// 「1曲リピート」はステートが足りないので、ステート 1 の上に専用画像を重ねる。
const REPEAT_ONE_IMAGE = loadImage("imgs/actions/repeat/key-one@2x.png");

/**
 * リピートの切り替え(オフ → 全曲 → 1曲 → オフ)。全曲はステート 1、1曲は専用画像で表す。
 */
@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.repeat" })
export class RepeatAction extends BaseAction<BaseSettings> {
	protected override get needsPolling(): boolean {
		return true;
	}

	protected override async onPoll(ev: WillAppearEvent<BaseSettings>, port: string, feed: PlayerFeed): Promise<void> {
		const mode: RepeatMode | undefined = feed.repeat ?? (feed.live ? undefined : (await this.get(port, "/repeat-mode"))?.mode);
		await this.applyState(ev.action, mode === "ALL" || mode === "ONE" ? 1 : 0);
		this.setIdleImage(ev.action, mode === "ONE" ? REPEAT_ONE_IMAGE : undefined);
	}

	override async onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		await this.send(ev, "/switch-repeat", { iteration: 1 });
	}
}
