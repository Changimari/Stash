/**
 * 画像の読み込み。webview が直接開けない形式（TIFF / BMP 等）は Rust 側が
 * 原寸のまま PNG に正規化して返すので、フロントは形式差を意識しなくてよい。
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Drawable } from "./compose";
import { native } from "./native";

/** サムネ（$APPDATA 配下）は asset プロトコルでそのまま <img> に渡せる。 */
export function thumbUrl(path: string | null | undefined): string | null {
  return path ? convertFileSrc(path) : null;
}

const objectUrls = new Set<string>();

function trackedObjectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

export function releaseObjectUrl(url: string | null | undefined) {
  if (url && objectUrls.has(url)) {
    URL.revokeObjectURL(url);
    objectUrls.delete(url);
  }
}

/** 原寸の画像を Blob で得る。合成コピーはこれを使う（サムネからは合成しない）。 */
export async function loadFullImageBlob(path: string): Promise<Blob> {
  const bytes = await native.loadFullImage(path);
  return new Blob([bytes]);
}

async function decode(blob: Blob): Promise<Drawable> {
  // createImageBitmap が使える環境ではそちらが速く、メインスレッドも止めない
  if (typeof createImageBitmap === "function" && blob.type !== "image/svg+xml") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // SVG など bitmap 化できない形式は <img> 経由に落とす
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("画像をデコードできませんでした"));
      img.src = url;
    });
    // decode 済みなので、この時点で revoke してよい
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 原寸のまま描画可能なオブジェクトにする。 */
export async function loadFullImage(path: string): Promise<Drawable> {
  return decode(await loadFullImageBlob(path));
}

/**
 * プレビュー用に縮小した画像。合成のレイアウトはすべて実寸比で決まるので、
 * これで合成しても原寸で合成したのと同じ見た目になる。
 */
export async function loadPreviewImage(path: string, maxSize = 720): Promise<Drawable> {
  const blob = await loadFullImageBlob(path);

  if (typeof createImageBitmap === "function" && blob.type !== "image/svg+xml") {
    try {
      const bitmap = await createImageBitmap(blob);
      const longest = Math.max(bitmap.width, bitmap.height);
      if (longest <= maxSize) return bitmap;

      const scale = maxSize / longest;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high",
      });
      bitmap.close();
      return resized;
    } catch {
      // 下の <img> 経路に落ちる
    }
  }
  return decode(blob);
}

export function blobToObjectUrl(blob: Blob): string {
  return trackedObjectUrl(blob);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // btoa は引数長に上限があるので分割して詰める
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
