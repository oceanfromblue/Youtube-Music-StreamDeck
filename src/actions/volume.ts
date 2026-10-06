import { action, KeyDownEvent, KeyUpEvent, streamDeck, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { PlayerFeed } from "../player-feed";
import { BaseAction, BaseSettings } from "./base-action";

type VolumeSettings = BaseSettings & {
	volume: number;
};

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.set-volume" })
export class SetVolumeAction extends BaseAction<VolumeSettings> {
	override async onKeyDown(ev: KeyDownEvent<VolumeSettings>): Promise<void> {
		try {
			const port = this.getPort(ev.payload.settings);

			// PIからは文字列で来ることがあるため数値化する
			let volume = Number(ev.payload.settings.volume);
			if (!Number.isFinite(volume)) {
				streamDeck.logger.warn("Volume is not configured.");
				return;
			}

			// 本家(pear-desktop)が5刻みのため、5の倍数にスナップしてから0〜100にクランプする。
			// (GET /volume は不安定なため参照せず、指定値をそのまま設定する)
			volume = Math.max(0, Math.min(100, Math.round(volume / 5) * 5));

			await this.post(port, "/volume", { volume });
		} catch (error) {
			streamDeck.logger.error("POST /volume failed", error);
		}
	}
}

type VolumeStepSettings = BaseSettings & {
	step?: number | string; // 1回で変える量(1〜50)
};

const DEFAULT_STEP = 10;
const HOLD_DELAY_MS = 450;  // 長押しとみなすまで
const HOLD_REPEAT_MS = 180; // 長押し中の繰り返し間隔

export function clampVolume(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * 音量を一定量ずつ上げ下げする。押しっぱなしで連続して変わる。
 * 変えた後の音量をキーに一瞬表示する。
 */
abstract class VolumeStepAction extends BaseAction<VolumeStepSettings> {
	protected abstract readonly direction: 1 | -1;
	private holds = new Map<string, NodeJS.Timeout>();

	override async onKeyDown(ev: KeyDownEvent<VolumeStepSettings>): Promise<void> {
		this.stopHold(ev.action.id);
		await this.step(ev);
		const repeat = () => {
			this.holds.set(ev.action.id, setTimeout(async () => {
				await this.step(ev);
				if (this.holds.has(ev.action.id)) {
					repeat();
				}
			}, HOLD_REPEAT_MS));
		};
		this.holds.set(ev.action.id, setTimeout(repeat, HOLD_DELAY_MS));
	}

	override onKeyUp(ev: KeyUpEvent<VolumeStepSettings>): void {
		this.stopHold(ev.action.id);
	}

	override async onWillDisappear(ev: WillDisappearEvent<VolumeStepSettings>): Promise<void> {
		this.stopHold(ev.action.id);
		await super.onWillDisappear(ev);
	}

	private stopHold(id: string): void {
		clearTimeout(this.holds.get(id));
		this.holds.delete(id);
	}

	private async step(ev: KeyDownEvent<VolumeStepSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const port = this.getPort(settings);
		const feed = this.feedFor(settings);
		try {
			const current = await this.currentVolume(settings);
			if (current === undefined) {
				await ev.action.showAlert();
				return;
			}
			const amount = Math.max(1, Math.min(50, Number(settings.step) || DEFAULT_STEP));
			const volume = clampVolume(current + this.direction * amount);
			// WebSocket の通知を待たずに次の押下へ反映できるよう、先に手元の値を更新しておく
			feed.volume = volume;
			await this.post(port, "/volume", { volume });
			await this.flash(ev.action, [`${volume}%`], { ms: 1000 });
		} catch (error) {
			streamDeck.logger.error("Failed to change the volume", error);
		}
	}
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.volume-up" })
export class VolumeUpAction extends VolumeStepAction {
	protected override readonly direction = 1 as const;
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.volume-down" })
export class VolumeDownAction extends VolumeStepAction {
	protected override readonly direction = -1 as const;
}

/**
 * ミュートの切り替え。ミュート中はキーがステート 1(赤)になる。
 */
@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.toggle-mute" })
export class ToggleMuteAction extends BaseAction<BaseSettings> {
	protected override get needsPolling(): boolean {
		return true;
	}

	protected override async onPoll(ev: WillAppearEvent<BaseSettings>, port: string, feed: PlayerFeed): Promise<void> {
		const muted = feed.muted ?? (feed.live ? undefined : (await this.get(port, "/volume"))?.isMuted);
		await this.applyState(ev.action, muted ? 1 : 0);
	}

	override async onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		const feed = this.feedFor(ev.payload.settings);
		const before = feed.muted;
		await this.send(ev, "/toggle-mute");
		if (before !== undefined) {
			// 通知を待たずに見た目を切り替える。応答より先に WebSocket で届いていれば、そちらを使う。
			if (feed.muted === before) {
				feed.muted = !before;
			}
			await this.applyState(ev.action, feed.muted ? 1 : 0);
		}
	}
}
