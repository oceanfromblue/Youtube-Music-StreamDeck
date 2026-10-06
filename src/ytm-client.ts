import { createHash } from "node:crypto";

/**
 * YouTube Music の内部 API (InnerTube) を直接叩く最小限のクライアント。
 * pear-desktop の API Server には「プレイリストの中身を読む」「プレイリストに曲を足す」手段が
 * 無いので、その2つだけをここで賄う。レスポンスの構造は頻繁に変わるため、決め打ちの
 * パスではなく、目的のレンダラーを再帰的に探して拾う。
 */

const ORIGIN = "https://music.youtube.com";
const API_BASE = `${ORIGIN}/youtubei/v1`;
const CLIENT_VERSION = "1.20250929.01.00";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15000;
const MAX_CONTINUATIONS = 50; // 1ページ約100曲

// 「いいねした曲」などシステムのリストは edit_playlist で足せないので一覧から外す。
const SYSTEM_PLAYLISTS = new Set(["LM", "SE", "WL"]);

// ログイン済みブラウザから写した Cookie。全体設定(GlobalSettings)由来。
export type YtmAuth = {
	cookie: string;
	authUser?: string;
	brandId?: string;
};

export type YtmPlaylist = {
	id: string;
	title: string;
	containsVideo?: boolean; // get_add_to_playlist で取れた時だけ。対象曲が既に入っているか
};

export type AddResult = "added" | "duplicate";

// プレイリストの1行。setVideoId はプレイリスト内での行の ID で、削除に要る。
export type PlaylistEntry = {
	videoId: string;
	setVideoId?: string;
};

export class YtmError extends Error {
	constructor(readonly kind: "auth" | "network" | "api", message: string) {
		super(message);
	}
}

/**
 * 共有リンク / ID のどちらを貼られても playlist ID を取り出す。
 * "https://music.youtube.com/playlist?list=PLxxx" や "VLPLxxx"(browseId)も受け付ける。
 */
export function parsePlaylistId(input: string | undefined): string | null {
	let value = (input ?? "").trim();
	if (!value) {
		return null;
	}
	const fromQuery = value.match(/[?&]list=([A-Za-z0-9_-]+)/);
	if (fromQuery) {
		value = fromQuery[1];
	}
	// browseId(VL + playlistId)で貼られた場合
	if (/^VL(PL|OLAK5uy_|RD|LM|LL|UU|FL|LR)/.test(value)) {
		value = value.slice(2);
	}
	return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

/** Cookie 文字列を整える("Cookie: " 付きや改行入りで貼られても通す)。 */
function cleanCookie(raw: string): string {
	return raw
		.replace(/^\s*cookie\s*:/i, "")
		.replace(/[\r\n]+/g, "")
		.trim();
}

function cookieValue(cookie: string, name: string): string | undefined {
	for (const part of cookie.split(";")) {
		const eq = part.indexOf("=");
		if (eq > 0 && part.slice(0, eq).trim() === name) {
			return part.slice(eq + 1).trim();
		}
	}
	return undefined;
}

/** Cookie に認証に必要な値(SAPISID 系)が入っているか。 */
export function hasUsableCookie(auth: YtmAuth | undefined): auth is YtmAuth {
	if (!auth?.cookie) {
		return false;
	}
	const cookie = cleanCookie(auth.cookie);
	return !!(cookieValue(cookie, "__Secure-3PAPISID") ?? cookieValue(cookie, "SAPISID"));
}

function authHeaders(auth: YtmAuth): Record<string, string> {
	const cookie = cleanCookie(auth.cookie);
	const sapisid = cookieValue(cookie, "__Secure-3PAPISID") ?? cookieValue(cookie, "SAPISID");
	if (!sapisid) {
		throw new YtmError("auth", "The cookie does not contain SAPISID / __Secure-3PAPISID. Copy the whole cookie header again.");
	}
	// ブラウザと同じ SAPISIDHASH を作る: sha1("<秒> <SAPISID> <origin>")
	const now = Math.floor(Date.now() / 1000);
	const hash = createHash("sha1").update(`${now} ${sapisid} ${ORIGIN}`).digest("hex");
	return {
		Cookie: cookie,
		Authorization: `SAPISIDHASH ${now}_${hash}`,
		"X-Goog-AuthUser": (auth.authUser ?? "").trim() || "0",
		Origin: ORIGIN,
		"X-Origin": ORIGIN,
	};
}

async function call(endpoint: string, body: Record<string, unknown>, auth?: YtmAuth): Promise<any> {
	const user: Record<string, unknown> = {};
	if (auth?.brandId?.trim()) {
		user.onBehalfOfUser = auth.brandId.trim();
	}
	const payload = {
		context: {
			client: { clientName: "WEB_REMIX", clientVersion: CLIENT_VERSION, hl: "en" },
			user,
		},
		...body,
	};
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"User-Agent": USER_AGENT,
		"X-Youtube-Client-Name": "67",
		"X-Youtube-Client-Version": CLIENT_VERSION,
		...(auth ? authHeaders(auth) : {}),
	};

	let response: Response;
	try {
		response = await fetch(`${API_BASE}/${endpoint}?prettyPrint=false`, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (error) {
		throw new YtmError("network", `Could not reach YouTube Music (${endpoint}): ${error}`);
	}

	if (response.status === 401 || response.status === 403) {
		throw new YtmError("auth", `YouTube Music rejected the request (${response.status}). The cookie may have expired.`);
	}
	if (!response.ok) {
		throw new YtmError("api", `${endpoint} failed: ${response.status} ${response.statusText}`);
	}
	return response.json();
}

/** node の中から key を持つオブジェクトを深さ優先で全部探し、その値を返す。 */
function findAll(node: unknown, key: string, out: any[] = []): any[] {
	if (Array.isArray(node)) {
		for (const child of node) {
			findAll(child, key, out);
		}
	} else if (node && typeof node === "object") {
		for (const [k, v] of Object.entries(node)) {
			if (k === key) {
				out.push(v);
			} else {
				findAll(v, key, out);
			}
		}
	}
	return out;
}

function textOf(value: any): string {
	if (!value) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value.simpleText === "string") {
		return value.simpleText;
	}
	if (Array.isArray(value.runs)) {
		return value.runs.map((run: any) => run?.text ?? "").join("");
	}
	return "";
}

// キュー項目(playlistPanelVideoRenderer)から再生可能な videoId を拾う。
function queueVideoIds(response: unknown): string[] {
	const ids: string[] = [];
	for (const data of findAll(response, "queueDatas").flat()) {
		const content = data?.content;
		const renderer = content?.playlistPanelVideoRenderer
			?? content?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
		if (renderer?.videoId && !renderer.unplayableText) {
			ids.push(renderer.videoId);
		}
	}
	return ids;
}

// プレイリスト画面の行(musicResponsiveListItemRenderer)と、続きを読むためのトークン。
function shelfRows(response: unknown): { rows: any[]; continuation?: string } {
	// 初回はプレイリスト本体の棚だけを見る(関連プレイリストなど他の棚を拾わないように)。
	const scope = findAll(response, "musicPlaylistShelfRenderer")[0] ?? response;
	const rows = findAll(scope, "musicResponsiveListItemRenderer").filter(row => row?.playlistItemData?.videoId);
	const token = findAll(scope, "continuationItemRenderer")
		.map(item => item?.continuationEndpoint?.continuationCommand?.token)
		.find((t): t is string => typeof t === "string");
	return { rows, continuation: token };
}

// プレイリスト画面を続きまで全部読む。
async function browsePlaylistRows(playlistId: string, auth?: YtmAuth): Promise<any[]> {
	const rows: any[] = [];
	let page = shelfRows(await call("browse", { browseId: `VL${playlistId}` }, auth));
	rows.push(...page.rows);
	for (let i = 0; page.continuation && i < MAX_CONTINUATIONS; i++) {
		page = shelfRows(await call("browse", { continuation: page.continuation }, auth));
		rows.push(...page.rows);
	}
	return rows;
}

/**
 * プレイリストに入っている再生可能な曲の videoId を順番通りに返す。
 * まず YouTube Music 自身がキュー作成に使う music/get_queue を試し、駄目ならプレイリスト画面
 * (browse)を続きまで読む。Cookie があれば非公開プレイリストも読める。
 */
export async function fetchPlaylistVideoIds(playlistId: string, auth?: YtmAuth): Promise<string[]> {
	const useAuth = hasUsableCookie(auth) ? auth : undefined;

	try {
		const ids = queueVideoIds(await call("music/get_queue", { playlistId }, useAuth));
		if (ids.length > 0) {
			return ids;
		}
	} catch (error) {
		if (error instanceof YtmError && error.kind === "network") {
			throw error;
		}
		// 形式が変わった等。browse で再挑戦する。
	}

	// グレーアウト(この地域で再生できない曲)は除く
	return (await browsePlaylistRows(playlistId, useAuth))
		.filter(row => row.musicItemRendererDisplayPolicy !== "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT")
		.map(row => row.playlistItemData.videoId as string);
}

/**
 * プレイリストの全行(再生できない曲も含む)。曲が入っているかの判定と、削除に使う。
 * YouTube Music の「入っているか」フラグや重複スキップは当てにならないため、中身を直接見る。
 */
export async function fetchPlaylistEntries(auth: YtmAuth, playlistId: string): Promise<PlaylistEntry[]> {
	return (await browsePlaylistRows(playlistId, auth)).map(row => ({
		videoId: row.playlistItemData.videoId,
		setVideoId: typeof row.playlistItemData.playlistSetVideoId === "string" ? row.playlistItemData.playlistSetVideoId : undefined,
	}));
}

/**
 * 曲をプレイリストに追加する。allowDuplicates が false なら既に入っている曲は足さない。
 * 足さなかった場合は "duplicate" を返す。
 */
export async function addToPlaylist(auth: YtmAuth, playlistId: string, videoId: string, allowDuplicates: boolean): Promise<AddResult> {
	const action: Record<string, string> = { action: "ACTION_ADD_VIDEO", addedVideoId: videoId };
	if (!allowDuplicates) {
		action.dedupeOption = "DEDUPE_OPTION_SKIP";
	}
	const response = await call("browse/edit_playlist", { playlistId, actions: [action] }, auth);

	if (typeof response?.status !== "string" || !response.status.includes("SUCCEEDED")) {
		const message = findAll(response, "responseText").map(textOf).find(Boolean)
			?? findAll(response, "text").map(textOf).find(Boolean)
			?? response?.status
			?? "unknown response";
		throw new YtmError("api", `Could not add to the playlist: ${message}`);
	}

	// 追加できた曲は playlistEditVideoAddedResultData で返ってくる。結果の一覧はあるのに
	// 追加分が無ければ、重複としてスキップされたと判断する。
	const results = response.playlistEditResults;
	if (!allowDuplicates && Array.isArray(results) && !results.some((r: any) => r?.playlistEditVideoAddedResultData)) {
		return "duplicate";
	}
	return "added";
}

/**
 * 曲を追加できるプレイリストの一覧。videoId を渡すと、YouTube Music の「プレイリストに保存」
 * ダイアログと同じ API で、自分が編集できるリストと、その曲が入っているかを取る。
 */
export async function listPlaylists(auth: YtmAuth, videoId?: string): Promise<YtmPlaylist[]> {
	if (videoId) {
		try {
			const response = await call("playlist/get_add_to_playlist", { videoIds: [videoId] }, auth);
			const playlists = findAll(response, "playlistAddToOptionRenderer")
				.filter(option => typeof option?.playlistId === "string")
				.map(option => ({
					id: parsePlaylistId(option.playlistId) ?? option.playlistId,
					title: textOf(option.title) || option.playlistId,
					containsVideo: option.containsSelectedVideos === "ALL",
				}))
				.filter(p => !SYSTEM_PLAYLISTS.has(p.id));
			if (playlists.length > 0) {
				return playlists;
			}
		} catch (error) {
			if (error instanceof YtmError && error.kind !== "api") {
				throw error;
			}
			// 形式が変わった等。ライブラリ一覧で代用する。
		}
	}

	// ライブラリのプレイリスト一覧(他人のプレイリストも混ざる)
	const response = await call("browse", { browseId: "FEmusic_liked_playlists" }, auth);
	const seen = new Set<string>();
	const playlists: YtmPlaylist[] = [];
	for (const item of findAll(response, "musicTwoRowItemRenderer")) {
		const browseId: unknown = item?.navigationEndpoint?.browseEndpoint?.browseId;
		if (typeof browseId !== "string" || !browseId.startsWith("VL")) {
			continue;
		}
		const id = browseId.slice(2);
		if (SYSTEM_PLAYLISTS.has(id) || seen.has(id)) {
			continue;
		}
		seen.add(id);
		playlists.push({ id, title: textOf(item.title) || id });
	}
	return playlists;
}

/** プレイリストから行を削除する(setVideoId が分かっている行だけ)。 */
export async function removeFromPlaylist(auth: YtmAuth, playlistId: string, entries: PlaylistEntry[]): Promise<number> {
	const actions = entries
		.filter(entry => entry.setVideoId)
		.map(entry => ({ action: "ACTION_REMOVE_VIDEO", removedVideoId: entry.videoId, setVideoId: entry.setVideoId }));
	if (actions.length === 0) {
		throw new YtmError("api", "Could not find the song's entry in the playlist to remove it.");
	}
	const response = await call("browse/edit_playlist", { playlistId, actions }, auth);
	if (typeof response?.status !== "string" || !response.status.includes("SUCCEEDED")) {
		const message = findAll(response, "responseText").map(textOf).find(Boolean) ?? response?.status ?? "unknown response";
		throw new YtmError("api", `Could not remove from the playlist: ${message}`);
	}
	return actions.length;
}
