import { streamDeck } from "@elgato/streamdeck";

// プラグイン全体で共有する設定。アクション設定と違ってプロファイルの書き出しに含まれないので、
// Cookie のような秘密もここに置く。
export type GlobalSettings = {
	port?: string;
	ytmCookie?: string;    // YouTube Music にログインしたブラウザの Cookie(Add to Playlist 用)
	ytmAuthUser?: string;  // 複数アカウントでログインしている時の番号(X-Goog-AuthUser)
	ytmBrandId?: string;   // ブランドアカウントで操作する時の ID(onBehalfOfUser)
};

export const DEFAULT_PORT = "26538";

let current: GlobalSettings = {};

// SingletonAction には global settings の受信フックが無いので、ここで一括して購読する。
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>(ev => {
	current = ev.settings ?? {};
});

export function globalSettings(): GlobalSettings {
	return current;
}

// 起動時に読み込み、ポートが無ければ既定値を書き込む(他のキーは消さない)。
export async function loadGlobalSettings(): Promise<void> {
	const settings = (await streamDeck.settings.getGlobalSettings<GlobalSettings>()) ?? {};
	current = settings;
	if (!settings.port) {
		current = { ...settings, port: DEFAULT_PORT };
		await streamDeck.settings.setGlobalSettings(current);
	}
}
