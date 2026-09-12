import { action } from "@elgato/streamdeck";
import { BaseAction, BaseSettings } from "./base-action";

// 表示専用のアクション。描画はすべて BaseAction が行うので、ここでは UUID を結び付けるだけ。
@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.artwork" })
export class ArtworkAction extends BaseAction<BaseSettings> {}
