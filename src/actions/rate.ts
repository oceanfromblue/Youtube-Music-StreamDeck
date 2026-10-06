import { action, Action, KeyDownEvent, streamDeck, WillAppearEvent } from "@elgato/streamdeck";
import { BaseAction, BaseSettings } from "./base-action";

// pear-desktop の GET /like-state が返す評価。
type LikeState = "LIKE" | "DISLIKE" | "INDIFFERENT";

// 再生中の曲の評価をキーに反映する。自分の評価(like なら LIKE)が付いていれば
// state 1 = 色付きのキー画像、そうでなければ state 0 = 通常のキー画像。
abstract class RateAction extends BaseAction<BaseSettings> {
	protected abstract readonly rating: LikeState;
	protected abstract readonly endpoint: string;

	// 評価を反映し続けるため、アートワーク非表示でもポーリングする。
	protected override get needsPolling(): boolean {
		return true;
	}

	override async onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		await this.send(ev, this.endpoint);
		try {
			// 押下直後は YTM 側の反映にわずかな遅れがあるため、少し待ってから取り直す。
			await new Promise(resolve => setTimeout(resolve, 250));
			await this.syncState(ev.action, this.getPort(ev.payload.settings));
		} catch (error) {
			streamDeck.logger.error("Failed to sync rating state", error);
		}
	}

	protected override async onPoll(ev: WillAppearEvent<BaseSettings>, port: string): Promise<void> {
		await this.syncState(ev.action, port);
	}

	// /like-state を見て評価が一致していれば state 1 に切り替える(変化した時だけ送る)。
	// エンドポイントが無い古いアプリでは get() が null を返すので通常表示のままになる。
	private async syncState(target: Action<BaseSettings>, port: string): Promise<void> {
		if (!target.isKey()) {
			return;
		}
		const res = await this.get(port, "/like-state");
		await this.applyState(target, res?.state === this.rating ? 1 : 0);
	}
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.like" })
export class LikeAction extends RateAction {
	protected override readonly rating = "LIKE" as const;
	protected override readonly endpoint = "/like";
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.dislike" })
export class DislikeAction extends RateAction {
	protected override readonly rating = "DISLIKE" as const;
	protected override readonly endpoint = "/dislike";
}
