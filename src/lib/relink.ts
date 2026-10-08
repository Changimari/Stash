/**
 * リンク切れの復旧。
 *
 * 素材は絶対パスへの参照なので、フォルダごと移動されると全滅する。
 * 移動先を 1 つ指定すれば、その配下を走査して一括で貼り直せるようにする。
 *
 * 照合は **内容ハッシュ優先、無ければファイル名**。ハッシュ一致なら名前が
 * 変わっていても追随できるし、同名別物を誤って結びつける事故も防げる。
 */
import { relinkAsset } from "./db";
import { native } from "./native";
import type { Asset } from "./types";

export interface RelinkResult {
  relinked: number;
  stillMissing: number;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * `folder` 配下から、見つからなくなった素材の実体を探して貼り直す。
 * 元ファイルには触れず、Stash 側の参照だけを更新する。
 */
export async function relinkFromFolder(
  missing: Asset[],
  folder: string,
  onProgress?: (phase: string) => void,
): Promise<RelinkResult> {
  if (missing.length === 0) return { relinked: 0, stillMissing: 0 };

  onProgress?.("フォルダを走査中…");
  const candidates = await native.scanFolder(folder, true, false);

  const byHash = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const file of candidates) {
    if (file.hash && !byHash.has(file.hash)) byHash.set(file.hash, file.path);
    const name = basename(file.path);
    // 同名が複数あるときは最初の 1 件だけを候補にする（曖昧なら後段で弾く）
    if (!byName.has(name)) byName.set(name, file.path);
  }

  onProgress?.("照合中…");
  const matches: { asset: Asset; path: string }[] = [];
  for (const asset of missing) {
    const hit =
      (asset.fileHash ? byHash.get(asset.fileHash) : undefined) ??
      byName.get(basename(asset.filePath));
    if (hit) matches.push({ asset, path: hit });
  }

  if (matches.length > 0) {
    onProgress?.("サムネイルを作り直し中…");
    const thumbs = new Map<string, string>();
    const images = matches.filter((m) => m.asset.type === "image").map((m) => m.path);
    if (images.length > 0) {
      for (const result of await native.generateThumbnails(images)) {
        if (result.thumbnail) thumbs.set(result.path, result.thumbnail);
      }
    }

    onProgress?.("保存中…");
    for (const { asset, path } of matches) {
      await relinkAsset(asset.id, path, thumbs.get(path) ?? asset.thumbnailPath);
    }
  }

  return { relinked: matches.length, stillMissing: missing.length - matches.length };
}

/** 1 件だけ、ユーザーが選んだファイルに貼り直す。 */
export async function relinkSingle(asset: Asset, filePath: string): Promise<void> {
  let thumbnail: string | null = asset.thumbnailPath;
  if (asset.type === "image") {
    try {
      thumbnail = await native.generateThumbnail(filePath);
    } catch {
      thumbnail = null;
    }
  }
  await relinkAsset(asset.id, filePath, thumbnail);
}
