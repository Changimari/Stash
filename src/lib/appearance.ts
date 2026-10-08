/**
 * 見た目まわりの実行時セットアップ。テーマ追従とネイティブマテリアルの検出。
 */
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import type { Settings } from "./settings";

export const PLATFORM = platform();
export const IS_MAC = PLATFORM === "macos";

// CSS 側で OS ごとの差（信号機ボタンぶんの余白など）を出し分けるための目印
document.documentElement.dataset.platform = PLATFORM;

/** `system` のときは属性を外し、CSS 側の prefers-color-scheme に委ねる。 */
export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.dataset.theme = theme;
  }
}

/** 実際に描かれている外観。合成コピーの帯色を `auto` にしたときの判定に使う。 */
export function resolvedScheme(theme: Settings["theme"]): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Rust から届くマテリアル種別（vibrancy / mica / opaque）を DOM に反映する。
 * すりガラスが効かない環境では CSS が不透明背景へ切り替わる（§11）。
 */
export function watchWindowMaterial() {
  return listen<string>("window:material", (event) => {
    document.documentElement.dataset.material = event.payload;
  });
}

export function watchSystemScheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
