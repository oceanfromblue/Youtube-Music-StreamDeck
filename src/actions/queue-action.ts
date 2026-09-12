import { BaseAction, BaseSettings } from "./base-action";

// キーを押したときに、選んだ曲をキューへどう入れるか。
export type QueueMode =
	| "end"      // 末尾に足すだけ(何も鳴っていなければ再生を始める)
	| "replace"  // 既存のキューを消してから入れて、すぐ再生する
	| "next";    // 現在の曲の直後に差し込んで、すぐ再生する

export type QueueSettings = BaseSettings & {
	queueMode?: QueueMode;
};

// キューに曲を積むアクション(Add Track / Add Playlist)の共通処理。
export abstract class QueueAction<T extends QueueSettings> extends BaseAction<T> {
	protected queueMode(settings: T): QueueMode {
		return settings.queueMode ?? "end";
	}

	/**
	 * videoId をキューに入れる。
	 * replace は既存のキューを消すので、消してよいと確定してから
	 * (プレイリストの取得に成功してから)呼ぶこと。
	 */
	protected async enqueue(port: string, videoIds: string[], mode: QueueMode): Promise<void> {
		const queue = await this.get(port, "/queue");
		const wasEmpty = !Array.isArray(queue?.items) || queue.items.length === 0;

		if (mode === "replace") {
			await this.delete(port, "/queue");
		}

		// 直後への差し込みは後から入れたものが手前に来るため、逆順で送って元の順序を保つ。
		const order = mode === "next" ? [...videoIds].reverse() : videoIds;
		for (const videoId of order) {
			try {
				await this.post(port, "/queue", {
					videoId,
					insertPosition: mode === "next" ? "INSERT_AFTER_CURRENT_VIDEO" : "INSERT_AT_END",
				});
			} catch {
				// 1曲失敗しても残りは追加する(ログは request() 側で出る)
			}
		}

		await new Promise(resolve => setTimeout(resolve, 1000));

		if (mode === "end") {
			// 何も鳴っていなかった時だけ、追加した曲から再生を始める。
			if (wasEmpty) {
				await this.post(port, "/play");
			}
			return;
		}

		// replace はキューを消しても再生中の「現在曲」が残り、next は後ろに積んだだけなので、
		// どちらも /next で追加した曲へ明示的に進める。何も鳴っていなければ先頭がそのまま現在曲になる。
		if (!wasEmpty) {
			await this.post(port, "/next");
		}
		await this.post(port, "/play");
	}
}
