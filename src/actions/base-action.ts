import { DidReceiveSettingsEvent, KeyDownEvent, SingletonAction, streamDeck, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { DEFAULT_PORT, globalSettings } from "../global-settings";
import { getPlayerFeed, PlayerFeed, SongInfo } from "../player-feed";
import { YtmAuth } from "../ytm-client";

export type TextPosition = "top" | "middle" | "bottom";

export type BaseSettings = {
	port: string; // Kept for individual overrides, but global is preferred.
    showArtwork: boolean;
    showText?: boolean;       // アートワーク上にテキストを重ねるか
    textTemplate?: string;    // {title} {artist} {album} {elapsed} {duration} {remaining} を含むテンプレート
    showProgress?: boolean;   // 下部に再生進捗バーを表示するか
    textFont?: string;        // FONT_PRESETS のキー、または "custom"
    textFontCustom?: string;  // textFont が "custom" の時のフォント名
    textSize?: number | string;
    textColor?: string;       // #rrggbb
    textWeight?: "bold" | "normal";
    textPosition?: TextPosition;
    textBackground?: boolean; // 文字の後ろを暗く(明るい文字色なら)/明るく(暗い文字色なら)するか。既定 true
};

// キー画像を差し替えられるもの(KeyAction / DialAction の共通部分)。
type ImageTarget = {
	readonly id: string;
	setImage(image?: string): Promise<void>;
	isKey(): boolean;
};

// ボタン(コンテキスト)ごとに保持する描画状態。
// SingletonAction はアクション種別ごとに1インスタンスだが、同じアクションを
// 複数キーに配置できるため、context(ev.action.id)単位で状態を分ける。
type RenderState<T extends BaseSettings> = {
	loop?: NodeJS.Timeout;
	loopMs: number;
	settings: T;
	fetching: boolean;
	lastDataAt: number;

	feed?: PlayerFeed;          // 再生状態の受信口(WebSocket)
	feedPort?: string;          // 受信口に使っているポート
	polling: boolean;           // onPoll 実行中か
	lastPollAt: number;

	trackKey?: string;          // 曲の同一性判定キー(videoId 等)
	imageDataUri?: string;      // キャッシュ済みカバー画像(data URI)
	imageDims?: { w: number; h: number };
	isPaused: boolean;

	text: string;               // テンプレート適用後の表示文字列
	textWidth: number;          // 概算ピクセル幅
	needsScroll: boolean;       // ボタン幅に収まらずスクロールが必要か
	scrollOffset: number;       // スクロール位置

	duration: number;           // 曲全体の秒数(songDuration)
	elapsed: number;            // 現在の再生位置(elapsedSeconds)

	lastImageSent?: string;     // 同一画像の再送を避けるため
	showingBlank: boolean;      // 直近で setImage(undefined) 済みか

	offlineSince?: number;      // API に届かなくなった時刻(猶予を見てから警告する)
	showingWarning: boolean;    // 警告画像を出しているか

	flashUntil?: number;        // 一時メッセージ(flash)を出している間は描画を止める
	sentState?: number;         // 直近で setState したステート
	idleImage?: string;         // アートワークを出していない時の画像(undefined ならステート画像)
	idleSent?: string;          // 直近で出した idleImage
};

// 描画パラメータ
const CANVAS_SIZE = 144;
const PAD_X = 8;
const SCROLL_GAP = 40;        // ループ時の文字列同士の間隔
const SCROLL_STEP = 1.4;      // 1フレームあたりの移動量(px)。小さいほどゆっくり(現在 約28px/秒)
const DATA_INTERVAL_MS = 1000;
const RENDER_INTERVAL_MS = 50; // 描画間隔(ms)。小さいほど滑らか(=高負荷)
const AVAIL_WIDTH = CANVAS_SIZE - PAD_X * 2;
const DEFAULT_TEMPLATE = "{title} - {artist}";

// テキストの見た目(自前SVG描画なので自由に調整可能)。設定が無ければこの値を使う。
const FONT_FAMILY = "'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
const FONT_WEIGHT = 700;
const DEFAULT_FONT_SIZE = 24;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 60;
const TEXT_COLOR = "#ffffff";

// Text Font で選べるフォント。キー画像は Stream Deck 側で描画されるため、PC に入っている
// フォントしか使えない。Windows / macOS のどちらかに無い場合に備えて代替を並べておく。
const FONT_PRESETS: Record<string, string> = {
	default: FONT_FAMILY,
	arial: "Arial, sans-serif",
	helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
	segoe: "'Segoe UI', Arial, sans-serif",
	verdana: "Verdana, sans-serif",
	tahoma: "Tahoma, sans-serif",
	trebuchet: "'Trebuchet MS', sans-serif",
	georgia: "Georgia, serif",
	times: "'Times New Roman', Times, serif",
	courier: "'Courier New', Courier, monospace",
	impact: "Impact, sans-serif",
	comic: "'Comic Sans MS', sans-serif",
	malgun: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
	"apple-sd": "'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
	nanum: "NanumGothic, 'Nanum Gothic', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
	"noto-kr": "'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
	meiryo: "Meiryo, 'Hiragino Sans', sans-serif",
	"yu-gothic": "'Yu Gothic', YuGothic, 'Hiragino Sans', sans-serif",
	hiragino: "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
};

// 進捗バー
const PROGRESS_HEIGHT = 6;               // バーの高さ(px)
const PROGRESS_FILL = "#1ed760";         // 経過部分(緑系)
const PROGRESS_TRACK = "rgba(255,255,255,0.25)"; // 未経過部分(トラック)

// キー押下の結果をキー上に一瞬出すメッセージ(flash)
const FLASH_MS = 1500;
const FLASH_BG = "#262626";

// API に届かない時の警告表示。セットアップ(API Server の有効化)に気付いてもらうため、
// 設定画面を開かない人にも見えるキー上に出す。一時的な切断で点滅しないよう猶予を置く。
const OFFLINE_GRACE_MS = 5000;
const WARNING_IMAGE = `data:image/svg+xml;base64,${Buffer.from(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">`
		+ `<rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#B03A3A"/>`
		+ `<path d="M72 24 L120 100 H24 Z" fill="none" stroke="#ffffff" stroke-width="10" stroke-linejoin="round"/>`
		+ `<rect x="67" y="50" width="10" height="26" rx="5" fill="#ffffff"/>`
		+ `<circle cx="72" cy="88" r="6" fill="#ffffff"/>`
		+ `<text x="72" y="132" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="24" font-weight="${FONT_WEIGHT}" fill="#ffffff">Setup</text>`
		+ `</svg>`,
).toString("base64")}`;

// テキスト描画に使う値(設定を検証・既定値で埋めたもの)
type TextStyle = {
	family: string;
	size: number;
	weight: number;
	color: string;
	position: TextPosition;
	background: boolean;
	dark: boolean; // 文字色が暗い(影・背景を白系にする)
};

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

// 半角/全角をざっくり重み付けして文字列の表示幅を概算する。
// Node 実行のため canvas measureText が使えず、スクロール要否とループ幅の
// 判定にはこの概算で十分。
function measureText(text: string, fontSize: number, narrowRatio = 0.55): number {
	let w = 0;
	for (const ch of text) {
		const wide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-〿぀-ヿ㐀-䶿一-鿿]/.test(ch);
		w += wide ? fontSize : fontSize * narrowRatio;
	}
	return w;
}

// 秒を m:ss(1時間以上なら h:mm:ss)にする
function formatTime(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function resolveTextStyle(settings: BaseSettings): TextStyle {
	let family = FONT_PRESETS[settings.textFont ?? "default"] ?? FONT_FAMILY;
	const custom = settings.textFontCustom?.trim();
	if (settings.textFont === "custom" && custom) {
		// 1つだけ書かれたら引用符で囲み、見つからない時のために既定フォントへ落とす
		family = custom.includes(",") ? custom : `'${custom.replace(/'/g, "")}', ${FONT_FAMILY}`;
	}

	const sizeValue = Number(settings.textSize);
	const size = Number.isFinite(sizeValue) && sizeValue > 0
		? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(sizeValue)))
		: DEFAULT_FONT_SIZE;

	const color = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(settings.textColor ?? "") ? settings.textColor! : TEXT_COLOR;
	const hex = color.length === 4 ? color.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : color;
	const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

	const position = settings.textPosition === "top" || settings.textPosition === "middle" ? settings.textPosition : "bottom";

	return {
		family,
		size,
		weight: settings.textWeight === "normal" ? 400 : FONT_WEIGHT,
		color,
		position,
		background: settings.textBackground !== false,
		dark: luminance < 0.45,
	};
}

export abstract class BaseAction<T extends BaseSettings> extends SingletonAction<T> {

	private states = new Map<string, RenderState<T>>();

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): void {
		const st = this.states.get(ev.action.id);
		if (st) {
			st.settings = ev.payload.settings;
			st.lastDataAt = 0;       // 次tickで即再評価(テンプレート変更などを反映)
			st.lastImageSent = undefined;
			st.text = "";            // 文字の見た目が変わったら測り直す
			st.scrollOffset = 0;
		}
	}

	// アートワーク表示に関係なく1秒ごとのポーリングを続けるか。
	// 再生中の曲の状態(いいね等)をキーに反映するアクションが true にする。
	protected get needsPolling(): boolean {
		return false;
	}

	// ポーリングのたびに呼ばれるフック(既定では何もしない)。ev は表示時のものなので、
	// 設定は ev.payload ではなく settings(最新)を使うこと。
	protected async onPoll(ev: WillAppearEvent<T>, port: string, feed: PlayerFeed, settings: T): Promise<void> {
		// サブクラス用。
	}

    protected getPort(settings: T): string {
        return globalSettings().port || settings.port || DEFAULT_PORT;
    }

    // Add to Playlist などで使う YouTube Music の Cookie(全体設定)。
    protected getYtmAuth(): YtmAuth | undefined {
        const g = globalSettings();
        return g.ytmCookie ? { cookie: g.ytmCookie, authUser: g.ytmAuthUser, brandId: g.ytmBrandId } : undefined;
    }

    protected getBaseUrl(port: string): string {
        return `http://localhost:${port}/api/v1`;
    }

    protected async request(
        port: string,
        endpoint: string,
        options: RequestInit = {}
    ): Promise<Response> {
        const url = `${this.getBaseUrl(port)}${endpoint}`;
        const method = options.method ?? "GET";
        const defaultHeaders: Record<string, string> = {
            "Content-Type": "application/json"
        };

        const headers = { ...defaultHeaders };
        if (options.headers) {
             Object.assign(headers, options.headers);
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers: headers
            });

            if (!response.ok) {
                streamDeck.logger.warn(`${method} ${endpoint} failed: ${response.status} ${response.statusText}`);
            }
            return response;
        } catch (error) {
            // アプリ未起動なら繋がらないのが普通なので、通信エラー自体は debug 止まりにする
            // (HTTP として応答がある失敗は上の warn で残る)。
            streamDeck.logger.debug(`${method} ${endpoint} error`, error);
            throw error;
        }
    }

    protected async get(port: string, endpoint: string): Promise<any> {
        const response = await this.request(port, endpoint, { method: "GET" });
        if (!response.ok) {
            return null;
        }
        // 再生中の曲が無いときの /song は 204(本文なし)。json() はそのまま呼ぶと落ちる。
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    protected async post(port: string, endpoint: string, body?: any): Promise<Response> {
        return this.request(port, endpoint, {
            method: "POST",
            body: body ? JSON.stringify(body) : undefined
        });
    }

    protected async patch(port: string, endpoint: string, body?: any): Promise<Response> {
        return this.request(port, endpoint, {
            method: "PATCH",
            body: body ? JSON.stringify(body) : undefined
        });
    }

    protected async delete(port: string, endpoint: string, body?: any): Promise<Response> {
        return this.request(port, endpoint, {
            method: "DELETE",
            body: body ? JSON.stringify(body) : undefined
        });
    }

	// キー押下で API を1回叩くだけのアクション向け。失敗してもキー側で出来ることは
	// ないので、ログに残して握り潰す。
	protected async send(ev: KeyDownEvent<T>, endpoint: string, body?: any): Promise<void> {
		try {
			await this.post(this.getPort(ev.payload.settings), endpoint, body);
		} catch (error) {
			streamDeck.logger.error(`POST ${endpoint} failed`, error);
		}
	}

	// 再生中の曲。WebSocket が生きていればその値、駄目なら /song を読む。
	protected async currentSong(settings: T): Promise<SongInfo | null> {
		const port = this.getPort(settings);
		const feed = getPlayerFeed(port);
		if (feed.live) {
			return feed.current();
		}
		try {
			return await this.get(port, "/song");
		} catch {
			return null;
		}
	}

	// 現在の音量。WebSocket で受け取った値があればそれ、無ければ GET /volume。
	protected async currentVolume(settings: T): Promise<number | undefined> {
		const feed = this.feedFor(settings);
		if (typeof feed.volume === "number") {
			return feed.volume;
		}
		try {
			const res = await this.get(this.getPort(settings), "/volume");
			return typeof res?.state === "number" ? res.state : undefined;
		} catch {
			return undefined;
		}
	}

	// 再生状態の受信口(キーが表示されている間はプラグイン全体で共有されている)。
	protected feedFor(settings: T): PlayerFeed {
		return getPlayerFeed(this.getPort(settings));
	}

	/**
	 * キーのステート画像を切り替える(前回と同じなら送らない)。
	 * 状態(いいね・ミュート等)を表すアクションが使う。ダイアルには何もしない。
	 */
	protected async applyState(target: { readonly id: string; isKey(): boolean; setState?(state: number): Promise<void> }, state: number): Promise<void> {
		const st = this.states.get(target.id);
		if (!target.isKey() || !target.setState || st?.sentState === state) {
			return;
		}
		if (st) {
			st.sentState = state;
		}
		await target.setState(state);
	}

	/**
	 * アートワークを出していない時に見せる画像を差し替える(undefined でステート画像に戻す)。
	 * ステートが2つでは足りない表示(リピートの「1曲」など)に使う。
	 */
	protected setIdleImage(target: ImageTarget, image: string | undefined): void {
		const st = this.states.get(target.id);
		if (!st || st.idleImage === image) {
			return;
		}
		st.idleImage = image;
		// いま待機表示中ならすぐ反映する(アートワーク・メッセージ表示中は次の待機時に出る)
		if (st.showingBlank && st.flashUntil === undefined && !st.showingWarning) {
			this.showIdle(target, st);
		}
	}

	/**
	 * キー上に短いメッセージ(例: "Added")を一瞬出す。表示中はアートワーク等の描画を止め、
	 * 時間が過ぎたら通常の表示に戻す。ms を長めにして、処理中の表示("Loading…")にも使う。
	 */
	protected async flash(target: ImageTarget, lines: string[], options: { ms?: number; color?: string } = {}): Promise<void> {
		const st = this.states.get(target.id);
		if (st) {
			st.flashUntil = Date.now() + (options.ms ?? FLASH_MS);
			st.lastImageSent = undefined;
			st.showingBlank = false;
		}
		try {
			await target.setImage(this.buildMessageImage(lines, options.color ?? FLASH_BG));
		} catch (error) {
			streamDeck.logger.debug("Failed to show a message on the key", error);
		}
	}

	// メッセージ用の画像。行数と文字数に合わせて文字サイズを縮める。
	private buildMessageImage(lines: string[], background: string): string {
		const size = CANVAS_SIZE;
		const fits = (line: string, fs: number) => measureText(line, fs) <= size - 12;
		let fontSize = lines.filter(Boolean).length <= 1 ? 30 : lines.filter(Boolean).length === 2 ? 26 : 22;
		while (fontSize > 16 && lines.some(line => !fits(line, fontSize))) {
			fontSize -= 1;
		}
		// それでも入らない行(長いプレイリスト名など)は末尾を … で切る
		const shown = lines.filter(Boolean).slice(0, 3).map(line => {
			let chars = Array.from(line);
			while (chars.length > 1 && !fits(chars.join(""), fontSize)) {
				chars = [...chars.slice(0, -2), "…"];
			}
			return chars.join("");
		});
		const lineHeight = fontSize * 1.2;
		const firstBaseline = size / 2 - (lineHeight * (shown.length - 1)) / 2 + fontSize * 0.35;
		const text = shown.map((line, i) =>
			`<text x="${size / 2}" y="${(firstBaseline + i * lineHeight).toFixed(1)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${FONT_WEIGHT}" fill="#ffffff">${escapeXml(line)}</text>`,
		).join("");
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
			+ `<rect width="${size}" height="${size}" fill="${escapeXml(background)}"/>`
			+ text
			+ `</svg>`;
		return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
	}

	// JPEG/PNG のヘッダから画像サイズを読む(画素はデコードしない)。読めなければ null。
	private getImageSize(buf: Buffer, mime: string): { w: number; h: number } | null {
		try {
			if (mime.includes("png")) {
				return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
			}
			// JPEG: SOFマーカー(0xC0〜0xCF、ただしC4/C8/CCを除く)を走査
			let off = 2;
			while (off + 8 < buf.length) {
				if (buf[off] !== 0xff) { off++; continue; }
				const marker = buf[off + 1];
				if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
					return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
				}
				off += 2 + buf.readUInt16BE(off + 2);
			}
		} catch {
			// 解析失敗時は null を返してフォールバックさせる
		}
		return null;
	}

	private formatTemplate(tpl: string | undefined, song: any): string {
		const t = tpl && tpl.trim() ? tpl : DEFAULT_TEMPLATE;
		const artist = song.artist ?? song.author ?? "";
		const duration = Number(song.songDuration) || 0;
		const elapsed = Number(song.elapsedSeconds) || 0;
		return t
			.replace(/\{title\}/gi, song.title ?? "")
			.replace(/\{artist\}/gi, artist)
			.replace(/\{album\}/gi, song.album ?? "")
			.replace(/\{elapsed\}/gi, formatTime(elapsed))
			.replace(/\{duration\}/gi, formatTime(duration))
			.replace(/\{remaining\}/gi, `-${formatTime(duration - elapsed)}`)
			.trim();
	}

	// 再生中の曲を取り込み、曲が変わった時だけカバー画像を取り直す。
	// 曲情報は WebSocket から受け取り、繋がっていない時だけ /song を叩く。
	private async refreshData(st: RenderState<T>, settings: T, feed: PlayerFeed): Promise<void> {
		const songInfo: SongInfo | null = feed.live ? feed.current() : await this.get(this.getPort(settings), "/song");

		// 再生していない / 画像なし は空表示扱い
		if (!songInfo || songInfo.isPaused || !songInfo.imageSrc) {
			st.isPaused = true;
			return;
		}
		st.isPaused = false;

		const key = songInfo.videoId ?? songInfo.imageSrc;
		if (key !== st.trackKey) {
			st.trackKey = key;
			st.scrollOffset = 0;
			const res = await fetch(songInfo.imageSrc);
			const blob = await res.blob();
			const arrayBuffer = await blob.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const base64 = buffer.toString("base64");
			st.imageDataUri = `data:${blob.type};base64,${base64}`;
			st.imageDims = this.getImageSize(buffer, blob.type) ?? { w: CANVAS_SIZE, h: CANVAS_SIZE };
		}

		// テキスト(テンプレートやアーティスト名は曲中でも変わり得るので毎回再評価)。
		// {elapsed} などを使うと毎秒変わるため、スクロール位置は曲が変わった時だけ戻す。
		if (settings.showText) {
			const text = this.formatTemplate(settings.textTemplate, songInfo);
			if (text !== st.text) {
				const style = resolveTextStyle(settings);
				st.text = text;
				st.textWidth = measureText(text, style.size, style.weight >= 600 ? 0.55 : 0.5);
				st.needsScroll = st.textWidth > AVAIL_WIDTH;
			}
		} else {
			st.text = "";
			st.needsScroll = false;
		}

		// 再生位置(進捗バー用)
		st.duration = Number(songInfo.songDuration) || 0;
		st.elapsed = Number(songInfo.elapsedSeconds) || 0;
	}

	// テキストの帯(位置ごとの背景と、ベースライン)を作る。
	private buildTextOverlay(st: RenderState<T>, style: TextStyle, bottomReserve: number): { defs: string; overlay: string } {
		const size = CANVAS_SIZE;
		const fs = style.size;
		const shade = style.dark ? "white" : "black";
		let defs = "";
		let overlay = "";
		let baseline: number;

		if (style.position === "top") {
			baseline = Math.round(7 + fs * 0.8);
			const bandBottom = baseline + Math.round(fs * 0.3 + 11);
			if (style.background) {
				defs = `<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade}" stop-opacity="0.9"/><stop offset="0.45" stop-color="${shade}" stop-opacity="0.55"/><stop offset="1" stop-color="${shade}" stop-opacity="0"/></linearGradient>`;
				overlay += `<rect x="0" y="0" width="${size}" height="${bandBottom}" fill="url(#grad)"/>`;
			}
		} else if (style.position === "middle") {
			baseline = Math.round(size / 2 + fs * 0.35);
			if (style.background) {
				const bandTop = Math.round(size / 2 - fs * 0.75 - 4);
				overlay += `<rect x="0" y="${bandTop}" width="${size}" height="${Math.round(fs * 1.5 + 8)}" fill="${shade}" fill-opacity="0.55"/>`;
			}
		} else {
			// 下部: 進捗バーを出す分だけテキストを上に逃がす
			baseline = size - bottomReserve - Math.round(fs * 0.3 + 6);
			const barTop = baseline - fs - 11;
			if (style.background) {
				// 下部に半透明グラデーション帯を敷いて可読性を確保(なめらかにフェード)
				defs = `<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade}" stop-opacity="0"/><stop offset="0.55" stop-color="${shade}" stop-opacity="0.55"/><stop offset="1" stop-color="${shade}" stop-opacity="0.9"/></linearGradient>`;
				overlay += `<rect x="0" y="${barTop}" width="${size}" height="${size - barTop}" fill="url(#grad)"/>`;
			}
		}

		const textEsc = escapeXml(st.text);
		// 縁取り(stroke)は細い字画を内側から削ってしまうため使わない。
		// 代わりに同じ文字を半透明で少し下にずらして敷き、影で輪郭を出す。
		const common = `font-family="${escapeXml(style.family)}" font-size="${fs}" font-weight="${style.weight}" letter-spacing="0.2"`;
		const shadow = style.dark ? "#ffffff" : "#000000";
		const emit = (x: number, anchor: string): string => {
			const xs = x.toFixed(1);
			return `<text x="${(x + 1).toFixed(1)}" y="${baseline + 1}" text-anchor="${anchor}" ${common} fill="${shadow}" fill-opacity="0.6">${textEsc}</text>`
				+ `<text x="${xs}" y="${baseline}" text-anchor="${anchor}" ${common} fill="${style.color}">${textEsc}</text>`;
		};
		if (st.needsScroll) {
			const loop = st.textWidth + SCROLL_GAP;
			const off = st.scrollOffset % loop;
			const x1 = PAD_X - off;
			const x2 = x1 + loop;
			overlay += emit(x1, "start");
			overlay += emit(x2, "start");
		} else {
			overlay += emit(size / 2, "middle");
		}
		return { defs, overlay };
	}

	// カバー画像(+任意のテキスト)から data URI を生成する。
	private buildImage(st: RenderState<T>, showText: boolean): string {
		const size = CANVAS_SIZE;
		const { w, h } = st.imageDims ?? { w: size, h: size };

		// YouTubeのサムネ等は長方形(16:9/4:3)で、そのまま渡すと正方形ボタンで
		// 引き伸ばされて潰れる。Stream Deckのキー画像レンダラ(QtSvg)は
		// preserveAspectRatio="slice"を無視して明示width/heightに伸縮するため、
		// 自前で「カバー(正方形を覆う)」寸法を計算し、縦横比を保ったまま中央配置する。
		const scale = Math.max(size / w, size / h);
		const dw = w * scale;
		const dh = h * scale;
		const dx = (size - dw) / 2;
		const dy = (size - dh) / 2;

		const showProgress = !!st.settings.showProgress;
		const bottomReserve = showProgress ? PROGRESS_HEIGHT : 0;

		let defs = "";
		let overlay = "";

		if (showText && st.text) {
			({ defs, overlay } = this.buildTextOverlay(st, resolveTextStyle(st.settings), bottomReserve));
		}

		// 進捗バー(最前面・最下部)。経過分を緑、未経過をトラック色で描く。
		if (showProgress) {
			const ratio = st.duration > 0 ? Math.min(1, Math.max(0, st.elapsed / st.duration)) : 0;
			const y = size - PROGRESS_HEIGHT;
			overlay += `<rect x="0" y="${y}" width="${size}" height="${PROGRESS_HEIGHT}" fill="${PROGRESS_TRACK}"/>`;
			if (ratio > 0) {
				overlay += `<rect x="0" y="${y}" width="${(size * ratio).toFixed(1)}" height="${PROGRESS_HEIGHT}" fill="${PROGRESS_FILL}"/>`;
			}
		}

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
			+ (defs ? `<defs>${defs}</defs>` : "")
			+ `<image href="${st.imageDataUri}" x="${dx}" y="${dy}" width="${dw}" height="${dh}" preserveAspectRatio="none"/>`
			+ overlay
			+ `</svg>`;
		return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
	}

	// 設定中のポートに対応する受信口を確保する(ポートが変わったら張り替える)。
	private attachFeed(st: RenderState<T>, settings: T): PlayerFeed {
		const port = this.getPort(settings);
		if (st.feedPort !== port) {
			st.feed?.release();
			st.feed = getPlayerFeed(port);
			st.feed.acquire();
			st.feedPort = port;
		}
		return st.feed!;
	}

	/**
	 * API に届いていなければキーへ警告画像を出す。警告中は true を返し、呼び出し側は
	 * 以降の処理(ポーリングや描画)を飛ばす。復帰したら画像を戻して通常描画に任せる。
	 */
	private applyOfflineWarning(ev: WillAppearEvent<T>, st: RenderState<T>, feed: PlayerFeed, now: number): boolean {
		if (!feed.online) {
			st.offlineSince ??= now;
			if (now - st.offlineSince < OFFLINE_GRACE_MS) {
				return false;
			}
			if (!st.showingWarning) {
				ev.action.setImage(WARNING_IMAGE);
				st.showingWarning = true;
				st.showingBlank = false;
				st.lastImageSent = undefined;
			}
			return true;
		}

		st.offlineSince = undefined;
		if (st.showingWarning) {
			st.showingWarning = false;
			// 一旦クリアしておけば、アートワーク表示ならこの後の描画が、
			// 非表示ならステート画像がそのまま出る。
			st.showingBlank = false;
			this.showIdle(ev.action, st);
		}
		return false;
	}

	// アートワークを出さない時の表示。idleImage が無ければステート画像に戻す。
	private showIdle(target: ImageTarget, st: RenderState<T>): void {
		if (st.showingBlank && st.idleSent === st.idleImage) {
			return;
		}
		target.setImage(st.idleImage);
		st.showingBlank = true;
		st.idleSent = st.idleImage;
		st.lastImageSent = undefined;
	}

	// スクロール要否に合わせてループ間隔を切り替える(必要な時だけ高頻度描画)。
	private applyLoopRate(ev: WillAppearEvent<T>, st: RenderState<T>): void {
		const desired = st.needsScroll && !st.isPaused ? RENDER_INTERVAL_MS : DATA_INTERVAL_MS;
		if (desired !== st.loopMs) {
			this.startLoop(ev, st, desired);
		}
	}

	private startLoop(ev: WillAppearEvent<T>, st: RenderState<T>, ms: number): void {
		if (st.loop) {
			clearInterval(st.loop);
		}
		st.loopMs = ms;
		st.loop = setInterval(() => this.tick(ev), ms);
	}

	private async tick(ev: WillAppearEvent<T>): Promise<void> {
		const st = this.states.get(ev.action.id);
		if (!st) {
			return;
		}
		const settings = st.settings;
		const feed = this.attachFeed(st, settings);
		const now = Date.now();

		// API に届かない状態が続いたらキーに警告を出す(アートワーク表示の有無に関わらず)。
		// 何をしても無反応になるため、セットアップ漏れやアプリ未起動に気付けるようにする。
		if (this.applyOfflineWarning(ev, st, feed, now)) {
			return;
		}

		// WebSocket にイベントが無いもの(いいね状態など)は1秒ごとに取りに行く。
		// アートワーク非表示でもキーの状態は更新し続ける。
		// tick 自体が約1秒間隔なので、タイマーの揺れで1回おきにならないよう少し余裕を持たせる。
		if (this.needsPolling && !st.polling && now - st.lastPollAt >= DATA_INTERVAL_MS - 100) {
			st.lastPollAt = now;
			st.polling = true;
			try {
				await this.onPoll(ev, this.getPort(settings), feed, settings);
			} catch (error) {
				streamDeck.logger.debug("Failed to poll player state", error);
			} finally {
				st.polling = false;
			}
		}

		// 一時メッセージを出している間は描画しない。終わったら通常の表示を出し直す。
		if (st.flashUntil !== undefined) {
			if (now < st.flashUntil) {
				return;
			}
			st.flashUntil = undefined;
			st.showingBlank = false;
			st.lastImageSent = undefined;
		}

		// アートワーク非表示: 一度だけ画像をクリアして終了(以降はステート画像が見える)
		if (!settings.showArtwork) {
			this.showIdle(ev.action, st);
			return;
		}

		// 曲情報の更新。WebSocket が繋がっていれば毎tick(通信なし)で反映し、
		// 繋がっていない間だけ1秒間隔で /song にフォールバックする。
		if (!st.fetching && (feed.live || now - st.lastDataAt >= DATA_INTERVAL_MS)) {
			st.lastDataAt = now;
			st.fetching = true;
			try {
				await this.refreshData(st, settings, feed);
			} catch (error) {
				streamDeck.logger.debug("Failed to refresh song data", error);
			} finally {
				st.fetching = false;
			}
			this.applyLoopRate(ev, st);
		}

		// 一時停止 / 画像なし は空表示
		if (st.isPaused || !st.imageDataUri) {
			this.showIdle(ev.action, st);
			return;
		}
		st.showingBlank = false;

		const showText = !!settings.showText;
		if (showText && st.needsScroll) {
			st.scrollOffset += SCROLL_STEP;
		}

		try {
			const image = this.buildImage(st, showText);
			// 静止表示なら同一画像を再送しない(USB帯域節約)。スクロール中は毎フレーム更新。
			if (!st.needsScroll && image === st.lastImageSent) {
				return;
			}
			ev.action.setImage(image);
			st.lastImageSent = image;
		} catch (error) {
			streamDeck.logger.error("Failed to render key image", error);
		}
	}

    override async onWillAppear(ev: WillAppearEvent<T>): Promise<void> {
		const st: RenderState<T> = {
			loopMs: DATA_INTERVAL_MS,
			settings: ev.payload.settings,
			fetching: false,
			lastDataAt: 0,
			isPaused: false,
			text: "",
			textWidth: 0,
			needsScroll: false,
			scrollOffset: 0,
			duration: 0,
			elapsed: 0,
			showingBlank: false,
			polling: false,
			lastPollAt: 0,
			showingWarning: false,
		};
		this.states.set(ev.action.id, st);
		this.attachFeed(st, st.settings);
		this.startLoop(ev, st, DATA_INTERVAL_MS);
	}

	override async onWillDisappear(
		ev: WillDisappearEvent<T>
	): Promise<void> {
		const st = this.states.get(ev.action.id);
		if (st?.loop) {
			clearInterval(st.loop);
		}
		st?.feed?.release();
		this.states.delete(ev.action.id);
	}

}
