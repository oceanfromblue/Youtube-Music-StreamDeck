import { BaseAction, BaseSettings } from "./base-action";

// キューに曲を積むアクション(Add Track / Add Playlist)の共通処理。
export abstract class QueueAction<T extends BaseSettings> extends BaseAction<T> {
	/**
	 * videoId をキューに追加する。
	 * forcePlay の場合は現在の曲の直後に差し込んですぐ再生する(既存のキューは消さない)。
	 */
	protected async enqueue(port: string, videoIds: string[], forcePlay: boolean): Promise<void> {
		const queue = await this.get(port, "/queue");
		const wasEmpty = !Array.isArray(queue?.items) || queue.items.length === 0;

		// 直後に差し込むと後から入れたものが手前に来るため、順序を保つには逆順で送る。
		const order = forcePlay ? [...videoIds].reverse() : videoIds;
		for (const videoId of order) {
			try {
				await this.post(port, "/queue", {
					videoId,
					insertPosition: forcePlay ? "INSERT_AFTER_CURRENT_VIDEO" : "INSERT_AT_END",
				});
			} catch {
				// 1曲失敗しても残りは追加する(ログは request() 側で出る)
			}
		}

		await new Promise(resolve => setTimeout(resolve, 1000));

		if (forcePlay) {
			// 差し込んだだけでは現在曲は変わらないので、/next で追加した曲へ進める。
			// キューが空だった場合は差し込んだ曲がそのまま現在曲になるため、進める必要はない。
			if (!wasEmpty) {
				await this.post(port, "/next");
			}
			await this.post(port, "/play");
		} else if (wasEmpty) {
			await this.post(port, "/play");
		}
	}
}
