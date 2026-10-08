/**
 * クリップボードへの書き込み。
 *
 * OS 差（§11）:
 * - 画像ビットマップのコピーはどの OS でも通る。合成コピーはこの経路（§6-1）。
 * - ファイル参照のコピーは macOS が file URL、Windows が CF_HDROP と実装が違う。
 *   プラグインが吸収できなかった場合は **絶対パスのテキストコピー** に落とし、
 *   何が起きたかを必ず UI に返す（黙って別のことをしない）。
 */
import {
  writeFiles,
  writeFilesURIs,
  writeImageBase64,
  writeText,
} from "tauri-plugin-clipboard-api";
import { composeCaption, type ComposeOptions } from "./compose";
import { blobToBase64, loadFullImage, loadFullImageBlob } from "./image";
import type { Asset } from "./types";

/** 実際に何をコピーしたか。UI のトーストはこれを見て文言を出す。 */
export type CopyKind = "image" | "imageWithCaption" | "file" | "path";

export interface CopyOutcome {
  kind: CopyKind;
  /** 意図した方法が使えず代替手段になった場合の説明。null なら想定どおり。 */
  fallbackReason: string | null;
}

async function copyImageBlob(blob: Blob) {
  await writeImageBase64(await blobToBase64(blob));
}

/** 素の画像をビットマップとしてコピーする。 */
export async function copyImage(asset: Asset): Promise<CopyOutcome> {
  await copyImageBlob(await loadFullImageBlob(asset.filePath));
  return { kind: "image", fallbackReason: null };
}

/** ★ キャプション帯を合成した 1 枚をコピーする（§6-1）。 */
export async function copyImageWithCaption(
  asset: Asset,
  options: ComposeOptions,
): Promise<CopyOutcome> {
  // 原寸で読み込んで合成する。サムネからは合成しない（§11 合成コピーの画質）。
  const image = await loadFullImage(asset.filePath);
  const { blob } = await composeCaption(image, options);
  await copyImageBlob(blob);
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
  return { kind: "imageWithCaption", fallbackReason: null };
}

/**
 * ファイル参照としてコピーする（Finder / エクスプローラに貼れる形）。
 * OS 側が受け付けなければパスのテキストコピーへ落とす。
 */
export async function copyFileReference(
  asset: Asset,
  allowPathFallback: boolean,
): Promise<CopyOutcome> {
  try {
    await writeFiles([asset.filePath]);
    return { kind: "file", fallbackReason: null };
  } catch (primaryError) {
    try {
      await writeFilesURIs([asset.filePath]);
      return { kind: "file", fallbackReason: null };
    } catch (uriError) {
      if (!allowPathFallback) {
        throw uriError instanceof Error ? uriError : new Error(String(primaryError));
      }
      await writeText(asset.filePath);
      return {
        kind: "path",
        fallbackReason: "この OS ではファイルのコピーに対応していないため、パスをテキストでコピーしました",
      };
    }
  }
}

/** 素材の種別に応じた「通常コピー」。画像は画像として、それ以外はファイル参照として。 */
export async function copyAsset(
  asset: Asset,
  options: { allowPathFallback: boolean },
): Promise<CopyOutcome> {
  if (asset.type === "image") {
    try {
      return await copyImage(asset);
    } catch (error) {
      if (!options.allowPathFallback) throw error;
      await writeText(asset.filePath);
      return {
        kind: "path",
        fallbackReason: "画像として読み込めなかったため、パスをテキストでコピーしました",
      };
    }
  }
  return copyFileReference(asset, options.allowPathFallback);
}

export async function copyPath(asset: Asset): Promise<CopyOutcome> {
  await writeText(asset.filePath);
  return { kind: "path", fallbackReason: null };
}
