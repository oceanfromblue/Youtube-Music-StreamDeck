import { action, KeyDownEvent } from "@elgato/streamdeck";
import { BaseAction, BaseSettings } from "./base-action";

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.toggle-play" })
export class TogglePlayAction extends BaseAction<BaseSettings> {
	override onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		return this.send(ev, "/toggle-play");
	}
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.next" })
export class NextAction extends BaseAction<BaseSettings> {
	override onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		return this.send(ev, "/next");
	}
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.previous" })
export class PreviousAction extends BaseAction<BaseSettings> {
	override async onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		// 1回目は再生位置が曲の先頭に戻るだけなので、前の曲へ移るには2回送る。
		await this.send(ev, "/previous");
		await this.send(ev, "/previous");
	}
}
