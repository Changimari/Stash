/**
 * 他アプリへのドラッグアウト（§6-4）。
 *
 * `@crabnebula/tauri-plugin-drag` は `icon`（ドラッグプレビュー画像のパス）を必須に
 * しているので（§11）、サムネがあればそれを、無ければ汎用アイコンを必ず用意して渡す。
 * 権限は `src-tauri/capabilities/default.json` の `drag:default`。
 */
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { invoke } from "@tauri-apps/api/core";
import { native } from "./native";
import type { Asset } from "./types";

let genericIcon: Promise<string> | null = null;
function genericDragIcon(): Promise<string> {
  if (!genericIcon) genericIcon = invoke<string>("generic_drag_icon");
  return genericIcon;
}

/** ドラッグプレビューに使う画像のパスを決める。 */
async function dragIconFor(asset: Asset): Promise<string> {
  if (asset.thumbnailPath) return asset.thumbnailPath;
  if (asset.type === "image") {
    try {
      // 取り込み直後などでサムネ未生成なら、その場で焼いて使う
      return await native.generateThumbnail(asset.filePath, 256);
    } catch {
      // 下の汎用アイコンに落ちる
    }
  }
  return genericDragIcon();
}

export interface DragHandlers {
  /** ドロップ成功・キャンセルのどちらでも呼ばれる。 */
  onFinish?: (result: "Dropped" | "Cancelled") => void;
}

/**
 * 素材のドラッグを開始する。
 *
 * `retreat` が true のときは、ドラッグ開始と同時に Stash のウィンドウを全部隠して
 * 直前のアプリを前面に戻す。オーバーレイを隠すだけでは足りない
 * （Stash が最前面のままなので、開いていた管理画面が繰り上がってドロップ先を覆う）。
 */
export async function dragOut(
  asset: Asset,
  options: { retreat: boolean } & DragHandlers,
): Promise<void> {
  const icon = await dragIconFor(asset);

  await native.shelfOwnDrag(true);
  await startDrag({ item: [asset.filePath], icon, mode: "copy" }, (payload) => {
    void native.shelfOwnDrag(false);
    options.onFinish?.(payload.result);
  });


  if (options.retreat) {
    await native.retreatOverlay();
  }
}

/**
 * 複数ファイルをまとめて他アプリへドラッグする（Shelf から使う）。
 *
 * Shelf は「集めてから一度に運ぶ」ための場所なので、まとめドラッグが本命の操作になる。
 * Shelf 自体は消さず、邪魔になる管理画面だけ引っ込める。
 *
 * OS へ渡す操作は **常に copy**。
 *
 * 一度 `move` にしたところ、Finder 以外のほとんどのアプリ（Electron 製のものを含む）で
 * ドロップ自体を拒否された。macOS では受け手が受け付ける操作を選ぶが、
 * このプラグインは 1 種類しか宣言できず、move だけを出すと copy しか解さないアプリに届かない。
 *
 * 「取り出したら手元から消える」という感触は Shelf 側の項目を消すことで表現する
 * （呼び出し側の `onFinish` が担当）。実ファイルは元の場所に残るので、取りこぼしも起きない。
 */
export async function dragOutPaths(
  paths: string[],
  options: { retreat: boolean } & DragHandlers & { icon?: string | null },
): Promise<void> {
  if (paths.length === 0) return;
  const icon = options.icon ?? (await genericDragIcon());

  // 自分が始めたドラッグで置き場が開かないよう、見張りを黙らせておく
  await native.shelfOwnDrag(true);
  await startDrag({ item: paths, icon, mode: "copy" }, (payload) => {
    void native.shelfOwnDrag(false);
    options.onFinish?.(payload.result);
  });

  if (options.retreat) {
    await native.retreatForShelfDrag();
  }
}
