import { streamDeck } from "@elgato/streamdeck";
import WebSocket from "ws";

// API Server (pear-desktop) の WebSocket が送ってくるメッセージ。
// 参照: src/plugins/api-server/backend/routes/websocket.ts
type FeedMessage = {
	type: "PLAYER_INFO" | "VIDEO_CHANGED" | "PLAYER_STATE_CHANGED" | "POSITION_CHANGED"
		| "VOLUME_CHANGED" | "REPEAT_CHANGED" | "SHUFFLE_CHANGED" | string;
	song?: SongInfo;
	isPlaying?: boolean;
	position?: number;
	volume?: number;
	muted?: boolean;
	repeat?: RepeatMode;
	shuffle?: boolean;
};

export type RepeatMode = "NONE" | "ALL" | "ONE";

// GET /song と同じ形の曲情報(必要なものだけ)。
export type SongInfo = {
	title?: string;
	artist?: string;
	album?: string | null;
	imageSrc?: string | null;
	videoId?: string;
	isPaused?: boolean;
	songDuration?: number;
	elapsedSeconds?: number;
};

const RECONNECT_MS = 5000;

/**
 * 再生状態の受信口。ポートごとに WebSocket を1本だけ張り、曲情報と再生位置を保持する。
 * 接続できない間は live=false になるので、呼び出し側は /song のポーリングに退避する。
 */
class PlayerFeed {
	private socket?: WebSocket;
	private reconnect?: NodeJS.Timeout;
	private subscribers = 0;
	private song: SongInfo | null = null;
	private isPaused = true;
	private position = 0;

	// 音量・ミュート・リピート・シャッフル。WebSocket から届くまでは undefined(不明)。
	volume?: number;
	muted?: boolean;
	repeat?: RepeatMode;
	shuffle?: boolean;

	// WebSocket が繋がっていて曲情報を配れる状態か。
	live = false;

	// HTTP で API に到達できるか。WebSocket を持たない古いビルドや、接続直後の判定に使う。
	reachable = false;

	constructor(private readonly port: string) {}

	// API 自体に届いているか(どちらか一方でも生きていれば操作はできる)。
	get online(): boolean {
		return this.live || this.reachable;
	}

	// GET /song と同じ形に整えて返す(繋がっていなければ null)。
	current(): SongInfo | null {
		if (!this.live || !this.song) {
			return null;
		}
		return { ...this.song, isPaused: this.isPaused, elapsedSeconds: this.position };
	}

	acquire(): void {
		this.subscribers++;
		if (this.subscribers === 1) {
			this.connect();
		}
	}

	release(): void {
		this.subscribers = Math.max(0, this.subscribers - 1);
		if (this.subscribers === 0) {
			this.disconnect();
		}
	}

	private connect(): void {
		if (this.socket) {
			return;
		}

		const socket = new WebSocket(`ws://localhost:${this.port}/api/v1/ws`);
		this.socket = socket;

		socket.on("open", () => {
			this.live = true;
			this.reachable = true;
			streamDeck.logger.info(`Connected to the player feed on port ${this.port}`);
			// アプリ起動後まだ曲イベントが流れていないと PLAYER_INFO の song が空なので、
			// その時だけ /song で現在の曲を1回だけ埋める。
			void this.seed();
		});
		socket.on("message", data => this.receive(data.toString()));
		socket.on("error", () => {
			// 接続できないだけ(アプリ未起動など)。close で再接続を予約する。
		});
		socket.on("close", () => {
			this.live = false;
			this.socket = undefined;
			this.volume = this.muted = this.repeat = this.shuffle = undefined;
			if (this.subscribers > 0 && !this.reconnect) {
				// WebSocket が駄目でも API 自体は生きているかもしれないので確認しておく。
				void this.probe();
				this.reconnect = setTimeout(() => {
					this.reconnect = undefined;
					this.connect();
				}, RECONNECT_MS);
			}
		});
	}

	private disconnect(): void {
		clearTimeout(this.reconnect);
		this.reconnect = undefined;
		this.live = false;
		this.reachable = false;
		this.volume = this.muted = this.repeat = this.shuffle = undefined;
		this.socket?.close();
		this.socket = undefined;
	}

	// HTTP で API に届くかだけを見る。認証が必要な設定(401)や API Server 無効は
	// 到達不可として扱い、キー側の警告表示につなげる。
	private async probe(): Promise<void> {
		try {
			const response = await fetch(`http://localhost:${this.port}/api/v1/song`);
			this.reachable = response.ok;
		} catch {
			this.reachable = false;
		}
	}

	private receive(raw: string): void {
		let message: FeedMessage;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}

		// PLAYER_INFO は全部入り、*_CHANGED はそれぞれの値だけを持ってくる。
		if (typeof message.volume === "number") {
			this.volume = message.volume;
		}
		if (typeof message.muted === "boolean") {
			this.muted = message.muted;
		}
		if (message.repeat === "NONE" || message.repeat === "ALL" || message.repeat === "ONE") {
			this.repeat = message.repeat;
		}
		if (typeof message.shuffle === "boolean") {
			this.shuffle = message.shuffle;
		}

		switch (message.type) {
			case "PLAYER_INFO":
			case "VIDEO_CHANGED":
				this.song = message.song ?? null;
				this.isPaused = message.isPlaying === false;
				this.position = message.position ?? 0;
				break;
			case "PLAYER_STATE_CHANGED":
				this.isPaused = !message.isPlaying;
				this.position = message.position ?? this.position;
				break;
			case "POSITION_CHANGED":
				this.position = message.position ?? this.position;
				break;
		}
	}

	private async seed(): Promise<void> {
		if (this.song) {
			return;
		}
		try {
			const response = await fetch(`http://localhost:${this.port}/api/v1/song`);
			const text = response.ok ? await response.text() : "";
			const song: SongInfo | null = text ? JSON.parse(text) : null;
			if (song && !this.song) {
				this.song = song;
				this.isPaused = !!song.isPaused;
				this.position = song.elapsedSeconds ?? 0;
			}
		} catch {
			// 次のイベントで埋まるので放置する
		}
	}
}

const feeds = new Map<string, PlayerFeed>();

// ポートに対応する受信口を返す(無ければ作る)。
export function getPlayerFeed(port: string): PlayerFeed {
	let feed = feeds.get(port);
	if (!feed) {
		feed = new PlayerFeed(port);
		feeds.set(port, feed);
	}
	return feed;
}

export type { PlayerFeed };
