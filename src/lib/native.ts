/**
 * Rust 側コマンドの薄いラッパ。invoke の文字列をここ以外に散らかさない。
 */
import { invoke } from "@tauri-apps/api/core";

export interface FileInfo {
  path: string;
  name: string;
  ext: string;
  size: number;
  /** 'image' | 'file' */
  kind: string;
  width: number | null;
  height: number | null;
  hash: string | null;
}

export interface ThumbResult {
  path: string;
  thumbnail: string | null;
  error: string | null;
}

export interface AdoptResult {
  original: string;
  path: string;
  error: string | null;
}

/** 片方だけ失敗することがあるので、成否はキーごとに返す。 */
export interface HotkeyResult {
  launcherError: string | null;
  shelfError: string | null;
}

export const native = {
  generateThumbnail: (path: string, max?: number) =>
    invoke<string>("generate_thumbnail", { path, max }),

  /** 一括取り込み用。Rust 側で rayon 並列。1 件失敗しても全体は止まらない。 */
  generateThumbnails: (paths: string[], max?: number) =>
    invoke<ThumbResult[]>("generate_thumbnails", { paths, max }),

  hashFile: (path: string) => invoke<string>("hash_file", { path }),

  probeFiles: (paths: string[], withHash = true) =>
    invoke<FileInfo[]>("probe_files", { paths, withHash }),

  scanFolder: (path: string, recursive = true, imagesOnly = false) =>
    invoke<FileInfo[]>("scan_folder", { path, recursive, imagesOnly }),

  /** 合成コピー用の原寸画像。webview が描ける形式に正規化されて返る。 */
  loadFullImage: (path: string) => invoke<ArrayBuffer>("load_full_image", { path }),

  pathsExist: (paths: string[]) => invoke<boolean[]>("paths_exist", { paths }),

  showOverlay: () => invoke<void>("show_overlay"),
  hideOverlay: () => invoke<void>("hide_overlay"),
  /** ドラッグ開始時に Stash のウィンドウを全部引っ込め、直前のアプリを前面へ戻す。 */
  retreatOverlay: () => invoke<void>("retreat_overlay"),

  showShelf: () => invoke<void>("show_shelf"),
  hideShelf: () => invoke<void>("hide_shelf"),
  toggleShelf: () => invoke<void>("toggle_shelf"),
  /** 預かったものが見えるよう、一覧の姿に伸ばして残す。 */
  expandShelf: () => invoke<void>("expand_shelf"),
  /** Shelf は残したまま、邪魔になる他の窓だけ引っ込める。 */
  retreatForShelfDrag: () => invoke<void>("retreat_for_shelf_drag"),

  /** 落とした瞬間のカーソル位置から左右を確定させる。 */
  shelfSide: () => invoke<"library" | "shelf" | null>("shelf_side"),
  /** 処理中・表示中は自動で閉じないようにする。 */
  shelfKeepOpen: (keep: boolean) => invoke<void>("shelf_keep_open", { keep }),
  /** 自前のドラッグ中は Shift の見張りを黙らせる。 */
  shelfOwnDrag: (active: boolean) => invoke<void>("shelf_own_drag", { active }),
  /** ドラッグ中 Shift の見張りを入切する。 */
  setShelfWatch: (enabled: boolean) => invoke<void>("set_shelf_watch", { enabled }),

  /** 既定のライブラリフォルダ（~/Documents/Stash）。 */
  defaultLibraryFolder: () => invoke<string>("default_library_folder"),
  /** 実ファイルをライブラリフォルダへ移動 / コピーする。 */
  adoptFiles: (paths: string[], folder: string, moveFile: boolean) =>
    invoke<AdoptResult[]>("adopt_files", { paths, folder, moveFile }),
  /** ライブラリフォルダの中にあるものだけ削除する。 */
  deleteManagedFiles: (paths: string[], folder: string) =>
    invoke<number>("delete_managed_files", { paths, folder }),
  toggleOverlay: () => invoke<void>("toggle_overlay"),
  showManager: () => invoke<void>("show_manager"),
  closeManager: () => invoke<void>("close_manager"),
  quitApp: () => invoke<void>("quit_app"),

  /** 失敗時は理由付きの文字列で reject される。設定画面はそれをそのまま出す。 */
  registerHotkeys: (launcher: string, shelf: string) =>
    invoke<HotkeyResult>("register_hotkeys", { launcher, shelf }),
  unregisterHotkeys: () => invoke<void>("unregister_hotkeys"),
};
