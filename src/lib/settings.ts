/**
 * アプリ設定。2 つの窓で共有するため、永続化は tauri-plugin-store に任せる。
 * 変更は `settings:changed` イベントで全窓へ伝わる。
 */
import { emit, listen } from "@tauri-apps/api/event";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_FONT_RATIO,
  FONT_RATIO_MAX,
  FONT_RATIO_MIN,
  type CaptionFit,
  type CaptionPlacement,
  type CaptionTheme,
} from "./compose";
import type { AssetAction } from "./types";

// Shelf はドラッグ中 Shift の置き場から使うのが本筋なので、既定のホットキーは割り当てない。
// ⌘⇧S は「別名で保存」等と衝突しやすい。欲しい人だけ設定で付ける。
export const DEFAULT_SHELF_HOTKEY = "";
const DEFAULT_HOTKEY = "CmdOrCtrl+Shift+L";

export interface Settings {
  /** グローバルホットキー。競合したら設定画面で再割り当てさせる（§11）。 */
  hotkey: string;
  /** Shelf の開閉。空文字なら割り当てなし（既定）。 */
  shelfHotkey: string;
  /** ドラッグ中に Shift を押すと 2 分割の置き場を出す。 */
  dropzoneOnShiftDrag: boolean;

  /**
   * 取り込んだ実ファイルの扱い。
   * - `move`（既定）: ライブラリフォルダへ移動する。取り込み元を片付けても壊れない
   * - `copy`: 複製を置き、原本もそのまま残す
   * - `keep`: 元の場所を参照するだけ（原本を消すとリンク切れになる）
   */
  importMode: "move" | "copy" | "keep";
  /** 素材の実ファイル置き場。空なら既定（~/Documents/Stash）。 */
  libraryFolder: string;
  theme: "system" | "light" | "dark";

  /**
   * ⏎ / クリックの動作。§7「既定アクション（DD優先/コピー優先）」。
   * ⇧⏎ / ⇧クリックは常に「これの逆のコピー」になるので、
   * §6-1 の「設定でデフォルト入れ替え可」もこの 1 項目で満たせる。
   */
  defaultAction: AssetAction;
  /** 画像以外・非対応 OS でのコピー時に、絶対パスのテキストコピーへ自動で落とす（§11）。 */
  pathFallbackOnCopy: boolean;
  /** ドラッグ開始と同時にオーバーレイを隠す（ドロップ先が見えるようにする）。 */
  hideOnDragStart: boolean;

  /** 合成コピーの帯まわり（§6-1）。既定は「透過 + 黒文字」。 */
  captionTheme: CaptionTheme;
  /** 文字の高さ。**画像に対する比率**（0.032 = 3.2%）。絶対 px では持たない。 */
  captionFontRatio: number;
  captionPlacement: CaptionPlacement;
  /** 文字が画像より長いとき、折り返すか・画像枠を超えて広げるか。 */
  captionFit: CaptionFit;

  /** グリッドの見た目 */
  gridColumns: number;
  showNamesInGrid: boolean;

  /** ライブラリ（管理画面）の並び順 */
  librarySort: LibrarySort;
  librarySortDesc: boolean;

  /**
   * ホットキーで開いたとき、最初に選ばれているカテゴリ。
   * `"all"` = すべて / `"last"` = 前回のまま / 数値 = そのカテゴリに固定。
   */
  overlayDefaultScope: "all" | "last" | number;
  /** `overlayDefaultScope: "last"` 用の記憶。ユーザーが直接いじる設定ではない。 */
  overlayLastScope: number | null;
}

/** 管理画面の並び替えキー。 */
export type LibrarySort = "added" | "name" | "useCount" | "lastUsed" | "size";

export const LIBRARY_SORTS: { value: LibrarySort; label: string }[] = [
  { value: "added", label: "追加日" },
  { value: "name", label: "名前" },
  { value: "useCount", label: "使用回数" },
  { value: "lastUsed", label: "最終使用" },
  { value: "size", label: "ファイルサイズ" },
];

export const DEFAULT_SETTINGS: Settings = {
  hotkey: DEFAULT_HOTKEY,
  shelfHotkey: DEFAULT_SHELF_HOTKEY,
  dropzoneOnShiftDrag: true,
  importMode: "move",
  libraryFolder: "",
  theme: "system",
  defaultAction: "copy",
  pathFallbackOnCopy: true,
  hideOnDragStart: true,
  captionTheme: "transparent",
  captionFontRatio: DEFAULT_FONT_RATIO,
  captionPlacement: "bottom",
  captionFit: "fit",
  gridColumns: 5,
  showNamesInGrid: true,
  librarySort: "added",
  librarySortDesc: true,
  overlayDefaultScope: "all",
  overlayLastScope: null,
};

const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
const CHANGED_EVENT = "settings:changed";

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) storePromise = load(STORE_FILE, { autoSave: 200 });
  return storePromise;
}

/**
 * 選択肢が変わった項目を既定値へ戻す。
 * 例: 旧バージョンの `captionTheme: "auto"` は今は存在しないので透過に落とす。
 * これをやらないと、更新後に不正な値のまま動いて描画が壊れる。
 */
function normalize(settings: Settings): Settings {
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;

  return {
    ...settings,
    theme: oneOf(settings.theme, ["system", "light", "dark"] as const, "system"),
    defaultAction: oneOf(
      settings.defaultAction,
      ["copy", "copyWithCaption", "drag"] as const,
      "copy",
    ),
    captionTheme: oneOf(
      settings.captionTheme,
      ["transparent", "light", "dark"] as const,
      "transparent",
    ),
    captionPlacement: oneOf(settings.captionPlacement, ["bottom", "top"] as const, "bottom"),
    captionFit: oneOf(settings.captionFit, ["fit", "extend"] as const, "fit"),
    importMode: oneOf(settings.importMode, ["move", "copy", "keep"] as const, "move"),
    librarySort: oneOf(
      settings.librarySort,
      LIBRARY_SORTS.map((s) => s.value),
      "added",
    ),
    overlayDefaultScope:
      typeof settings.overlayDefaultScope === "number" ||
      settings.overlayDefaultScope === "last"
        ? settings.overlayDefaultScope
        : "all",
    captionFontRatio: Number.isFinite(settings.captionFontRatio)
      ? Math.min(FONT_RATIO_MAX, Math.max(FONT_RATIO_MIN, settings.captionFontRatio))
      : DEFAULT_FONT_RATIO,
  };
}

/**
 * 旧バージョンの設定を今の形に読み替える。
 * `captionFontScale`（既定 3.2% に対する倍率）は `captionFontRatio`（比率そのもの）へ。
 */
function migrate(saved: Record<string, unknown>): Partial<Settings> {
  const next = { ...saved } as Partial<Settings> & { captionFontScale?: number };
  if (next.captionFontRatio == null && Number.isFinite(next.captionFontScale)) {
    next.captionFontRatio = DEFAULT_FONT_RATIO * (next.captionFontScale as number);
  }
  delete next.captionFontScale;
  return next;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const store = await getStore();
    const saved = await store.get<Record<string, unknown>>(STORE_KEY);
    // 既定値とマージする。設定項目を増やしても古い設定ファイルが壊れない。
    return normalize({ ...DEFAULT_SETTINGS, ...migrate(saved ?? {}) });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(next: Settings): Promise<void> {
  const store = await getStore();
  await store.set(STORE_KEY, next);
  await store.save();
  await emit(CHANGED_EVENT, next);
}

/** 他の窓での設定変更を受け取る。 */
export function onSettingsChanged(handler: (settings: Settings) => void) {
  return listen<Settings>(CHANGED_EVENT, (event) => handler(event.payload));
}

// ─────────────── ショートカットの割り当て ───────────────

/**
 * クリック / ⏎ と、Shift 付きのそれぞれに割り当てる動作。
 *
 * - 通常: `defaultAction`（既定はコピー＝画像だけ）
 * - Shift: そのもう一方のコピー（既定はキャプション付き）
 *
 * 「どちらを主にするか」は `defaultAction` 1 つで決まる。各画面はこの結果だけを見る。
 */
export function copyBindings(settings: Settings): {
  plain: AssetAction;
  withShift: AssetAction;
} {
  const plain = settings.defaultAction;
  return {
    plain,
    withShift: plain === "copyWithCaption" ? "copy" : "copyWithCaption",
  };
}

/** 「⌘⇧L」のような表示用文字列へ（macOS 記号表記）。 */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  if (!isMac) return accelerator.replace(/CmdOrCtrl/gi, "Ctrl").replace(/\+/g, "+");
  const symbols: Record<string, string> = {
    cmdorctrl: "⌘",
    command: "⌘",
    cmd: "⌘",
    control: "⌃",
    ctrl: "⌃",
    alt: "⌥",
    option: "⌥",
    shift: "⇧",
    enter: "⏎",
    return: "⏎",
    escape: "⎋",
    space: "␣",
    backspace: "⌫",
    delete: "⌦",
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
  };
  return accelerator
    .split("+")
    .map((part) => symbols[part.trim().toLowerCase()] ?? part.trim().toUpperCase())
    .join("");
}
