#!/usr/bin/env node
/**
 * Generate every Stream Deck image from the SVG sources in tools/icons/.
 *
 * Sources: a white glyph on a transparent 256x256 canvas.
 *
 * tools/icons/<action>.svg  ->  imgs/actions/<action>/
 *   icon.png     (20x20)   white glyph, transparent bg   (shown in the actions list)
 *   icon@2x.png  (40x40)
 *   key.png      (72x72)   grey bg + pink circle + glyph (shown on the key)
 *   key@2x.png   (144x144)
 *   key-<state>[@2x].png    glyph on a full-bleed colour - extra key states (see STATES)
 *   encoder[@2x].png (72x72) circle + glyph on transparent - dial actions only (see ENCODERS)
 *
 * tools/icons/states/<name>.svg  alternative glyphs used by STATES (not actions themselves)
 *
 * tools/icons/logo.svg      ->  imgs/plugin/
 *   category-icon.png / @2x (28 / 56)    white glyph, transparent bg
 *   marketplace.png  / @2x  (288 / 512)  grey bg + pink circle + glyph
 *
 * Usage:
 *   npm run icons              # everything
 *   npm run icons -- like next # only these sources
 */

import { readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// --- appearance ---
const GREY = "#F2F2F2"; // key background
const PINK = "#E05656"; // key circle
const CIRCLE_PCT = 66; // circle diameter as % of the canvas
const GLYPH_PCT = 52; // glyph size as % of the circle diameter
const RENDER = 1024; // rasterisation size of the sources

// Extra key states: <action>/key-<name>[@2x].png, the glyph on a full-bleed colour instead of
// the circle, so the state reads at a glance rather than by hue alone. `glyph` swaps in a
// different source from tools/icons/states/ for that state.
const GREEN = "#3E9B63"; // muted green: "on"
const STATES = {
	like: [{ name: "active", fill: "#D0618F" }], // muted pink
	dislike: [{ name: "active", fill: "#4F7FAE" }], // muted blue
	"add-to-playlist": [{ name: "active", fill: GREEN, glyph: "add-to-playlist-active" }],
	"toggle-mute": [{ name: "active", fill: "#C0504D" }], // muted red
	shuffle: [{ name: "active", fill: GREEN }],
	repeat: [
		{ name: "active", fill: GREEN },
		{ name: "one", fill: GREEN, glyph: "repeat-one" },
	],
};

// Dial (Stream Deck +) actions: also write encoder[@2x].png for the dial in the Stream Deck app.
const ENCODERS = new Set(["volume-dial", "seek-dial"]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "tools", "icons");
const IMGS = join(ROOT, "jp.hayate-kojima.ytm-desktop-controller.sdPlugin", "imgs");

/** Rasterise an SVG source and trim it down to the glyph itself. */
async function rasterize(file) {
	const png = await sharp(file, { density: 72 * (RENDER / 256) })
		.resize(RENDER, RENDER, { fit: "inside" })
		.png()
		.toBuffer();
	return sharp(png).trim({ threshold: 1 }).png().toBuffer();
}

/** White glyph centred on a transparent square. */
async function writeIcon(glyph, size, out) {
	const img = await sharp(glyph)
		.resize(size, size, { fit: "inside" })
		.toBuffer();
	await sharp({
		create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
	})
		.composite([{ input: img, gravity: "centre" }])
		.png()
		.toFile(out);
}

/**
 * Grey square + coloured circle + white glyph. Pass `fill` instead of `circle` for the
 * "on" look: the colour covers the whole key and the circle is dropped. The glyph keeps
 * the same size either way, so it does not jump when the state flips.
 */
async function writeKey(glyph, size, out, { circlePct = CIRCLE_PCT, glyphPct = GLYPH_PCT, circle = PINK, fill, background = GREY } = {}) {
	const box = Math.round((size * circlePct * glyphPct) / 10000);
	const img = await sharp(glyph).resize(box, box, { fit: "inside" }).toBuffer();
	const bg = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
			`<rect width="${size}" height="${size}" fill="${fill ?? background}"/>` +
			(fill ? "" : `<circle cx="${size / 2}" cy="${size / 2}" r="${(size * circlePct) / 200}" fill="${circle}"/>`) +
			`</svg>`,
	);
	await sharp(bg).composite([{ input: img, gravity: "centre" }]).png().toFile(out);
}

async function buildAction(name, file) {
	const glyph = await rasterize(file);
	const dir = join(IMGS, "actions", name);
	await mkdir(dir, { recursive: true });
	await writeIcon(glyph, 20, join(dir, "icon.png"));
	await writeIcon(glyph, 40, join(dir, "icon@2x.png"));
	await writeKey(glyph, 72, join(dir, "key.png"));
	await writeKey(glyph, 144, join(dir, "key@2x.png"));
	const states = STATES[name] ?? [];
	for (const state of states) {
		const stateGlyph = state.glyph ? await rasterize(join(SRC, "states", `${state.glyph}.svg`)) : glyph;
		await writeKey(stateGlyph, 72, join(dir, `key-${state.name}.png`), { fill: state.fill });
		await writeKey(stateGlyph, 144, join(dir, `key-${state.name}@2x.png`), { fill: state.fill });
	}
	if (ENCODERS.has(name)) {
		await writeKey(glyph, 72, join(dir, "encoder.png"), { circlePct: 90, background: "none" });
		await writeKey(glyph, 144, join(dir, "encoder@2x.png"), { circlePct: 90, background: "none" });
	}
	const extras = [...states.map((s) => s.name), ...(ENCODERS.has(name) ? ["encoder"] : [])];
	console.log(`  actions/${name}${extras.length ? ` (+ ${extras.join(", ")})` : ""}`);
}

async function buildPlugin(file) {
	const glyph = await rasterize(file);
	const dir = join(IMGS, "plugin");
	await mkdir(dir, { recursive: true });
	await writeIcon(glyph, 28, join(dir, "category-icon.png"));
	await writeIcon(glyph, 56, join(dir, "category-icon@2x.png"));
	await writeKey(glyph, 288, join(dir, "marketplace.png"), { circlePct: 70, glyphPct: 44 });
	await writeKey(glyph, 512, join(dir, "marketplace@2x.png"), { circlePct: 70, glyphPct: 44 });
	console.log("  plugin");
}

const only = process.argv.slice(2).map((a) => basename(a, ".svg"));
const sources = (await readdir(SRC))
	.filter((f) => f.endsWith(".svg"))
	.filter((f) => only.length === 0 || only.includes(basename(f, ".svg")));

if (sources.length === 0) {
	console.error(`No matching SVG in ${SRC}`);
	process.exit(1);
}

console.log("Generating images from tools/icons/");
for (const f of sources.sort()) {
	const name = basename(f, ".svg");
	if (name === "logo") await buildPlugin(join(SRC, f));
	else await buildAction(name, join(SRC, f));
}
