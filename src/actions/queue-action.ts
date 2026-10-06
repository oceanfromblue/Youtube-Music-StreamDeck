import { BaseAction, BaseSettings } from "./base-action";

// キーを押したときに、選んだ曲をキューへどう入れるか。
export type QueueMode =
	| "end"      // 末尾に足すだけ(何も鳴っていなければ再生を始める)
	| "replace"  // 足した曲をすぐ再生し、それまでのキューを消す
	| "next";    // 現在の曲の直後に差し込んで、すぐ再生する

export type QueueSettings = BaseSettings & {
	queueMode?: QueueMode;
};

export type EnqueueResult = {
	added: number;     // 実際にキューへ入った曲数
	requested: number; // 入れようとした曲数(上限で切ったあと)
};

// 1回に入れる上限。pear-desktop は1曲ずつしか足せず、200曲で十数秒かかる。
export const MAX_TRACKS = 200;

// POST /queue の間隔。renderer 側の取得(非同期)がなるべく追い越し合わないよう少し空ける。
const ADD_SPACING_MS = 60;
// キューの件数を見に行く間隔と、件数が増えなくなってから諦めるまでの時間。
// 再生できない曲は入らないので、全部揃うのを待ち続けない。
const SETTLE_POLL_MS = 600;
const SETTLE_IDLE_MS = 2500;
const FIRST_TRACK_TIMEOUT_MS = 3000;
const FIRST_TRACK_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type QueueState = {
	items: any[];
	current: number; // 再生中の曲の位置(無ければ -1)
};

// キュー項目の videoId 一覧(音声版/動画版の切り替え先も含む)と、再生中かどうか。
export function itemInfo(item: any): { ids: Set<string>; selected: boolean } {
	const wrapper = item?.playlistPanelVideoWrapperRenderer;
	const primary = item?.playlistPanelVideoRenderer ?? wrapper?.primaryRenderer?.playlistPanelVideoRenderer;
	const ids = new Set<string>();
	if (primary?.videoId) {
		ids.add(primary.videoId);
	}
	for (const counterpart of wrapper?.counterpart ?? []) {
		const id = counterpart?.counterpartRenderer?.playlistPanelVideoRenderer?.videoId;
		if (id) {
			ids.add(id);
		}
	}
	return { ids, selected: primary?.selected === true };
}

/**
 * キューに曲を積むアクションの共通処理。
 *
 * pear-desktop の API でできるのは「1曲足す」「並べ替え」「n 番目を再生」「n 番目を消す」だけなので、
 * それを組み合わせる。以前は DELETE /queue と /next を使っていたが、DELETE /queue は
 * YouTube Music のプレイヤーごと閉じて再生バーが消え(再生中の曲だけが鳴り続ける)、
 * /next は v3.12.0 で効かないことがあるため、どちらも使わない。
 */
export abstract class QueueAction<T extends QueueSettings> extends BaseAction<T> {
	protected queueMode(settings: T): QueueMode {
		const mode = settings.queueMode;
		return mode === "replace" || mode === "next" ? mode : "end";
	}

	private async readQueue(port: string): Promise<QueueState> {
		const queue = await this.get(port, "/queue");
		const items: any[] = Array.isArray(queue?.items) ? queue.items : [];
		return { items, current: items.findIndex(item => itemInfo(item).selected) };
	}

	private async add(port: string, videoId: string, afterCurrent: boolean): Promise<void> {
		try {
			await this.post(port, "/queue", {
				videoId,
				insertPosition: afterCurrent ? "INSERT_AFTER_CURRENT_VIDEO" : "INSERT_AT_END",
			});
		} catch {
			// 1曲失敗しても残りは追加する(ログは request() 側で出る)
		}
	}

	// 足した曲が反映されるまで待つ。expected 件に達するか、件数が増えなくなったら返す。
	private async waitForQueue(port: string, expected: number, idleMs = SETTLE_IDLE_MS): Promise<QueueState> {
		let state = await this.readQueue(port);
		let lastLength = state.items.length;
		let lastChange = Date.now();
		while (state.items.length < expected && Date.now() - lastChange < idleMs) {
			await sleep(SETTLE_POLL_MS);
			state = await this.readQueue(port);
			if (state.items.length !== lastLength) {
				lastLength = state.items.length;
				lastChange = Date.now();
			}
		}
		return state;
	}

	/**
	 * キューの start 番目から並ぶ block を、desired(videoId の順番)通りに並べ替える。
	 * renderer 側の取得は非同期で、追加の完了順が前後することがあるため。
	 */
	private async reorder(port: string, block: any[], start: number, desired: string[]): Promise<void> {
		const infos = block.map(itemInfo);
		const used = new Set<number>();
		const target: number[] = [];
		for (const id of desired) {
			const k = infos.findIndex((info, i) => !used.has(i) && info.ids.has(id));
			if (k >= 0) {
				used.add(k);
				target.push(k);
			}
		}
		// 照合できなかったもの(差し替えられた曲など)は後ろへ
		infos.forEach((_, i) => !used.has(i) && target.push(i));

		const current = infos.map((_, i) => i);
		for (let pos = 0; pos < target.length; pos++) {
			const from = current.indexOf(target[pos]);
			if (from === pos) {
				continue;
			}
			await this.patch(port, `/queue/${start + from}`, { toIndex: start + pos });
			current.splice(pos, 0, current.splice(from, 1)[0]);
		}
	}

	// 1曲目を足して、入った位置を返す(入らなければ次の曲で再挑戦)。
	private async addFirst(port: string, ids: string[], before: QueueState, afterCurrent: boolean): Promise<{ index: number; used: number } | null> {
		const expectedIndex = afterCurrent ? before.current + 1 : before.items.length;
		for (let attempt = 0; attempt < Math.min(FIRST_TRACK_ATTEMPTS, ids.length); attempt++) {
			const id = ids[attempt];
			await this.add(port, id, afterCurrent);
			const state = await this.waitForQueue(port, before.items.length + 1, FIRST_TRACK_TIMEOUT_MS);
			if (state.items.length > before.items.length) {
				const match = (i: number) => state.items[i] && itemInfo(state.items[i]).ids.has(id);
				const index = match(expectedIndex) ? expectedIndex : state.items.findIndex((_, i) => match(i));
				return { index: index >= 0 ? index : expectedIndex, used: attempt + 1 };
			}
		}
		return null;
	}

	/**
	 * videoId をキューに入れる。replace / next と、何も再生していない時は、
	 * 1曲目が入った時点で再生を始めてから残りを足す(待たずに鳴り始めるように)。
	 */
	protected async enqueue(port: string, videoIds: string[], mode: QueueMode): Promise<EnqueueResult> {
		const ids = videoIds.slice(0, MAX_TRACKS);
		const result: EnqueueResult = { added: 0, requested: ids.length };
		if (ids.length === 0) {
			return result;
		}

		const before = await this.readQueue(port);
		const hasCurrent = before.current >= 0;
		const playNow = mode !== "end" || !hasCurrent;
		const afterCurrent = mode === "next" && hasCurrent;

		// 末尾に足すだけ: 全部足してから順番を整える。
		if (!playNow) {
			for (const id of ids) {
				await this.add(port, id, false);
				await sleep(ADD_SPACING_MS);
			}
			const after = await this.waitForQueue(port, before.items.length + ids.length);
			result.added = Math.max(0, after.items.length - before.items.length);
			await this.reorder(port, after.items.slice(before.items.length, before.items.length + result.added), before.items.length, ids);
			return result;
		}

		// 1曲目を足してすぐ再生する(n 番目を再生 = PATCH /queue)。
		const first = await this.addFirst(port, ids, before, afterCurrent);
		if (!first) {
			return result;
		}
		result.added = 1;
		await this.patch(port, "/queue", { index: first.index });
		await sleep(500);
		// 一時停止中だった場合に備えて再生も指示する(再生中なら何も起きない)
		await this.post(port, "/play");

		// replace: 新しい曲が鳴り始めたら、元のキュー(新しい曲より前にある)を後ろから消す。
		let playing = first.index;
		if (mode === "replace") {
			for (let i = first.index - 1; i >= 0; i--) {
				await this.delete(port, `/queue/${i}`);
			}
			playing = 0;
			// 新しい曲の後ろに残ったもの(自動再生で積まれた曲など)も消す
			const now = await this.readQueue(port);
			for (let i = now.items.length - 1; i > playing; i--) {
				await this.delete(port, `/queue/${i}`);
			}
		}

		// 残りの曲は「再生中(=1曲目)の直後」に逆順で差し込むと元の順に並ぶ。末尾に足すと、
		// YouTube Music が後ろに自動で積む曲(自動再生)と混ざることがあるため。
		const rest = ids.slice(first.used);
		if (rest.length === 0) {
			return result;
		}
		const middle = await this.readQueue(port);
		for (const id of [...rest].reverse()) {
			await this.add(port, id, true);
			await sleep(ADD_SPACING_MS);
		}
		const after = await this.waitForQueue(port, middle.items.length + rest.length);
		const added = Math.max(0, after.items.length - middle.items.length);
		result.added += added;
		const start = (after.current >= 0 ? after.current : playing) + 1;
		await this.reorder(port, after.items.slice(start, start + added), start, rest);
		return result;
	}
}
