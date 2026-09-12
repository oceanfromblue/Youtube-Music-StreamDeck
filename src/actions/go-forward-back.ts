import { action, KeyDownEvent } from "@elgato/streamdeck";
import { BaseAction, BaseSettings } from "./base-action";

type GoForwardBackSettings = BaseSettings & {
	time: string;
};

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.go-forward" })
export class GoForwardAction extends BaseAction<GoForwardBackSettings> {
	override onKeyDown(ev: KeyDownEvent<GoForwardBackSettings>): Promise<void> {
		return this.send(ev, "/go-forward", { seconds: parseInt(ev.payload.settings.time, 10) });
	}
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.go-back" })
export class GoBackAction extends BaseAction<GoForwardBackSettings> {
	override onKeyDown(ev: KeyDownEvent<GoForwardBackSettings>): Promise<void> {
		return this.send(ev, "/go-back", { seconds: parseInt(ev.payload.settings.time, 10) });
	}
}
