/**
 * アートワーク表示に関する設定(Show Artwork / Track Info / 文字の見た目 / 進捗バー)を
 * <div id="artwork-options"></div> の中に組み立てる。アートワークを出せるアクションの
 * Property Inspector で共通に使う。
 */
(() => {
	const container = document.getElementById("artwork-options");
	if (!container) {
		return;
	}

	const style = document.createElement("style");
	style.textContent = `
		.sd-hint {
			margin: 0 8px 6px 104px;
			color: #9a9a9a;
			font-family: "Segoe UI", Arial, Roboto, Helvetica, sans-serif;
			font-size: 8pt;
			line-height: 1.4;
		}
	`;
	document.head.appendChild(style);

	container.innerHTML = `
		<sdpi-item label="Show Now-playing Artwork">
			<sdpi-checkbox setting="showArtwork" label="Show Now-playing Artwork"></sdpi-checkbox>
		</sdpi-item>
		<sdpi-item label="Show Track Info">
			<sdpi-checkbox setting="showText" id="showText" label="Overlay text on artwork"></sdpi-checkbox>
		</sdpi-item>
		<sdpi-item label="Text Template">
			<sdpi-textfield setting="textTemplate" class="text-opt" placeholder="{title} - {artist}"></sdpi-textfield>
		</sdpi-item>
		<div class="sd-hint">{title} {artist} {album} {elapsed} {duration} {remaining}</div>
		<sdpi-item label="Text Position">
			<sdpi-select setting="textPosition" class="text-opt" default="bottom">
				<option value="top">Top</option>
				<option value="middle">Middle</option>
				<option value="bottom">Bottom</option>
			</sdpi-select>
		</sdpi-item>
		<sdpi-item label="Font">
			<sdpi-select setting="textFont" id="textFont" class="text-opt" default="default">
				<option value="default">Default (Helvetica Neue / Segoe UI)</option>
				<option value="arial">Arial</option>
				<option value="helvetica">Helvetica Neue</option>
				<option value="segoe">Segoe UI</option>
				<option value="verdana">Verdana</option>
				<option value="tahoma">Tahoma</option>
				<option value="trebuchet">Trebuchet MS</option>
				<option value="georgia">Georgia (serif)</option>
				<option value="times">Times New Roman (serif)</option>
				<option value="courier">Courier New (monospace)</option>
				<option value="impact">Impact</option>
				<option value="comic">Comic Sans MS</option>
				<optgroup label="Korean">
					<option value="malgun">Malgun Gothic (Windows)</option>
					<option value="apple-sd">Apple SD Gothic Neo (macOS)</option>
					<option value="nanum">NanumGothic</option>
					<option value="noto-kr">Noto Sans KR</option>
				</optgroup>
				<optgroup label="Japanese">
					<option value="meiryo">Meiryo (Windows)</option>
					<option value="yu-gothic">Yu Gothic</option>
					<option value="hiragino">Hiragino Sans (macOS)</option>
				</optgroup>
				<option value="custom">Custom (type the name below)</option>
			</sdpi-select>
		</sdpi-item>
		<sdpi-item label="Custom Font">
			<sdpi-textfield setting="textFontCustom" id="textFontCustom" placeholder="Font name installed on this PC"></sdpi-textfield>
		</sdpi-item>
		<sdpi-item label="Font Size">
			<sdpi-select setting="textSize" class="text-opt" default="24">
				<option value="10">10</option>
				<option value="12">12</option>
				<option value="14">14</option>
				<option value="16">16</option>
				<option value="18">18</option>
				<option value="20">20</option>
				<option value="22">22</option>
				<option value="24">24 (default)</option>
				<option value="26">26</option>
				<option value="28">28</option>
				<option value="32">32</option>
				<option value="36">36</option>
				<option value="40">40</option>
				<option value="48">48</option>
			</sdpi-select>
		</sdpi-item>
		<sdpi-item label="Font Weight">
			<sdpi-select setting="textWeight" class="text-opt" default="bold">
				<option value="bold">Bold</option>
				<option value="normal">Normal</option>
			</sdpi-select>
		</sdpi-item>
		<sdpi-item label="Text Color">
			<sdpi-color setting="textColor" class="text-opt" default="#ffffff"></sdpi-color>
		</sdpi-item>
		<sdpi-item label="Text Background">
			<sdpi-checkbox setting="textBackground" class="text-opt" default="true" label="Shade behind the text"></sdpi-checkbox>
		</sdpi-item>
		<sdpi-item label="Show Progress Bar">
			<sdpi-checkbox setting="showProgress" label="Show playback progress"></sdpi-checkbox>
		</sdpi-item>
	`;

	// sdpi-select は子要素の「追加」を監視して項目を作るため、innerHTML で最初から入っている
	// <option> は拾われず空のリストになる。一度外して付け直し、追加として認識させる。
	container.querySelectorAll("sdpi-select").forEach(select => {
		const children = Array.from(select.childNodes);
		children.forEach(child => select.removeChild(child));
		children.forEach(child => select.appendChild(child));
	});

	function readSettings(p) {
		if (!p) return {};
		if (p.settings) return p.settings;
		if (p.payload && p.payload.settings) return p.payload.settings;
		return {};
	}

	// Track Info がオフの間は文字の設定を無効化し、Custom Font は Font が Custom の時だけ使える。
	function init() {
		if (!window.SDPIComponents) { setTimeout(init, 50); return; }
		const showText = container.querySelector("#showText");
		const font = container.querySelector("#textFont");
		const custom = container.querySelector("#textFontCustom");
		const options = container.querySelectorAll(".text-opt");
		let textOn = false;
		let fontValue = "default";

		function toggle(el, on) {
			if (on) { el.removeAttribute("disabled"); }
			else { el.setAttribute("disabled", ""); }
		}
		function sync() {
			options.forEach(el => toggle(el, textOn));
			toggle(custom, textOn && fontValue === "custom");
		}
		function apply(settings) {
			textOn = !!settings.showText;
			fontValue = settings.textFont || "default";
			sync();
		}

		const client = SDPIComponents.streamDeckClient;
		client.getSettings().then(p => apply(readSettings(p)));
		client.didReceiveSettings.subscribe(p => apply(readSettings(p)));
		showText.addEventListener("valuechange", () => { textOn = !!showText.value; sync(); });
		font.addEventListener("valuechange", () => { fontValue = font.value || "default"; sync(); });
		sync();
	}
	init();
})();
