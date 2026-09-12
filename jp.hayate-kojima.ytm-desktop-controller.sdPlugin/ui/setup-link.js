/**
 * すべてのアクションの Property Inspector の末尾に、前提条件の注意書きを出す。
 * 設定画面を開かない人にはキー上の警告(BaseAction)で気付いてもらい、ここでは
 * 設定を触っている人向けに手順へのリンクを添える。
 */
(() => {
	const SETUP_URL = "https://github.com/tuat-yate/ytm-desktop-controller#setup";

	// sdpi-components のフォント指定は各コンポーネントの Shadow DOM 内(--font-family)にあり、
	// 素の要素には継承されない。ラベル(Port: など)と同じ見た目にするためここで実値を書く。
	const style = document.createElement("style");
	style.textContent = `
		.sd-setup-note {
			margin: 12px 8px 8px;
			padding: 8px 10px;
			border-left: 3px solid #E05656;
			border-radius: 3px;
			background-color: rgba(255, 255, 255, 0.07);
			color: #d8d8d8;
			font-family: "Segoe UI", Arial, Roboto, Helvetica, sans-serif;
			font-size: 9pt;
			line-height: 1.45;
		}
		.sd-setup-note a {
			color: #f28b8b;
			text-decoration: underline;
			cursor: pointer;
		}
		.sd-setup-note a:hover {
			color: #ffb3b3;
		}
	`;
	document.head.appendChild(style);

	const note = document.createElement("div");
	note.className = "sd-setup-note";
	note.innerHTML =
		"<b>Note:</b> You need <b>pear-desktop v3.11.0+</b> with the API Server plugin enabled " +
		'(authorization: none). For more detail, see the <a href="#">setup guide</a>.';

	note.querySelector("a").addEventListener("click", event => {
		// PI 内の通常のリンクは既定ブラウザで開かないため、Stream Deck 本体に openUrl を投げる。
		event.preventDefault();
		window.SDPIComponents?.streamDeckClient.send("openUrl", { url: SETUP_URL });
	});

	document.body.append(note);
})();
