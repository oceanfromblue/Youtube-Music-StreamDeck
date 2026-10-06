import { action, DialAction, DialDownEvent, DialRotateEvent, streamDeck, TouchTapEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { PlayerFeed } from "../player-feed";
import { BaseAction, BaseSettings } from "./base-action";
import { clampVolume } from "./volume";

type DialSettings = BaseSettings & {
	step?: number | string; // 1クリックで変える量(音量: %、シーク: 秒)
};

function formatTime(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Stream Deck + のダイアル用の共通処理。タッチ画面($B1 レイアウト: 値の文字 + バー)を
 * 1秒ごとに更新し、内容が変わった時だけ送る。
 */
abstract class DialBase extends BaseAction<DialSettings> {
	private sentFeedback = new Map<string, string>();

	protected override get needsPolling(): boolean {
		return true;
	}

	protected abstract feedback(feed: PlayerFeed): { value: string; indicator: number };

	protected async render(target: DialAction<DialSettings>, feed: PlayerFeed): Promise<void> {
		const { value, indicator } = this.feedback(feed);
		const key = `${value}|${indicator}`;
		if (this.sentFeedback.get(target.id) === key) {
			return;
		}
		this.sentFeedback.set(target.id, key);
		await target.setFeedback({ value, indicator: Math.max(0, Math.min(100, Math.round(indicator))) });
	}

	protected override async onPoll(ev: WillAppearEvent<DialSettings>, port: string, feed: PlayerFeed): Promise<void> {
		if (ev.action.isDial()) {
			await this.render(ev.action, feed);
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<DialSettings>): Promise<void> {
		this.sentFeedback.delete(ev.action.id);
		await super.onWillDisappear(ev);
	}
}

/**
 * 回して音量、押す(タッチ)とミュート切り替え。
 */
@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.volume-dial" })
export class VolumeDialAction extends DialBase {
	protected override feedback(feed: PlayerFeed): { value: string; indicator: number } {
		if (feed.volume === undefined) {
			return { value: "--", indicator: 0 };
		}
		return { value: feed.muted ? "Muted" : `${feed.volume}%`, indicator: feed.muted ? 0 : feed.volume };
	}

	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const feed = this.feedFor(settings);
		try {
			const current = await this.currentVolume(settings);
			if (current === undefined) {
				return;
			}
			const amount = Math.max(1, Math.min(25, Number(settings.step) || 5));
			const volume = clampVolume(current + ev.payload.ticks * amount);
			feed.volume = volume;
			await this.post(this.getPort(settings), "/volume", { volume });
			await this.render(ev.action, feed);
		} catch (error) {
			streamDeck.logger.error("Failed to change the volume", error);
		}
	}

	override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
		await this.toggleMute(ev.action, ev.payload.settings);
	}

	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		await this.toggleMute(ev.action, ev.payload.settings);
	}

	private async toggleMute(target: DialAction<DialSettings>, settings: DialSettings): Promise<void> {
		try {
			const feed = this.feedFor(settings);
			const before = feed.muted;
			await this.post(this.getPort(settings), "/toggle-mute");
			// 応答より先に WebSocket で新しい値が届いていなければ、手元で切り替えておく
			if (before !== undefined && feed.muted === before) {
				feed.muted = !before;
			}
			await this.render(target, feed);
		} catch (error) {
			streamDeck.logger.error("POST /toggle-mute failed", error);
		}
	}
}

/**
 * 回して早送り/巻き戻し、押す(タッチ)と再生/一時停止。再生位置をタッチ画面に出す。
 */
@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.seek-dial" })
export class SeekDialAction extends DialBase {
	protected override feedback(feed: PlayerFeed): { value: string; indicator: number } {
		const song = feed.current();
		const duration = Number(song?.songDuration) || 0;
		if (!song || duration <= 0) {
			return { value: "--:--", indicator: 0 };
		}
		const elapsed = Math.min(duration, Number(song.elapsedSeconds) || 0);
		return { value: `${formatTime(elapsed)} / ${formatTime(duration)}`, indicator: (elapsed / duration) * 100 };
	}

	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const seconds = Math.abs(ev.payload.ticks) * Math.max(1, Math.min(60, Number(settings.step) || 5));
		try {
			await this.post(this.getPort(settings), ev.payload.ticks > 0 ? "/go-forward" : "/go-back", { seconds });
		} catch (error) {
			streamDeck.logger.error("Failed to seek", error);
		}
	}

	override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
		await this.togglePlay(ev.payload.settings);
	}

	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		await this.togglePlay(ev.payload.settings);
	}

	private async togglePlay(settings: DialSettings): Promise<void> {
		try {
			await this.post(this.getPort(settings), "/toggle-play");
		} catch (error) {
			streamDeck.logger.error("POST /toggle-play failed", error);
		}
	}
}
