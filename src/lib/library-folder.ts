/**
 * 素材の実ファイル置き場。
 *
 * Stash は絶対パスへの参照しか持たないので、取り込み元（ダウンロードフォルダ等）を
 * 片付けるとライブラリが総崩れになる。既定では取り込み時に実ファイルを
 * この専用フォルダへ **移動** し、以後はそこを参照する。
 */
import { relinkAsset } from "./db";
import { native } from "./native";
import { loadSettings, type Settings } from "./settings";

let cachedDefault: string | null = null;

/** 設定が空なら既定（~/Documents/Stash）を返す。 */
export async function resolveLibraryFolder(settings?: Settings): Promise<string> {
  const configured = (settings ?? (await loadSettings())).libraryFolder.trim();
  if (configured) return configured;
  cachedDefault ??= await native.defaultLibraryFolder();
  return cachedDefault;
}

/**
 * すでに登録済みの素材を、あとからライブラリフォルダへ移す。
 * `keep` で運用していた人が方針を変えたとき用。
 */
export async function migrateExistingAssets(
  assets: { id: number; filePath: string; type: string; thumbnailPath: string | null }[],
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
): Promise<{ moved: number; failed: number }> {
  if (settings.importMode === "keep") return { moved: 0, failed: 0 };

  const folder = await resolveLibraryFolder(settings);
  const outside = assets.filter((a) => !a.filePath.startsWith(folder));
  if (outside.length === 0) return { moved: 0, failed: 0 };

  onProgress?.(0, outside.length);
  const results = await native.adoptFiles(
    outside.map((a) => a.filePath),
    folder,
    settings.importMode === "move",
  );
  const byOriginal = new Map(results.map((r) => [r.original, r]));

  // 移動でパスが変わるとサムネのキャッシュキーも変わるので焼き直す
  const relocated = outside.filter((a) => {
    const r = byOriginal.get(a.filePath);
    return r && !r.error && r.path !== a.filePath;
  });
  const thumbs = new Map<string, string>();
  const images = relocated
    .filter((a) => a.type === "image")
    .map((a) => byOriginal.get(a.filePath)!.path);
  if (images.length > 0) {
    for (const t of await native.generateThumbnails(images)) {
      if (t.thumbnail) thumbs.set(t.path, t.thumbnail);
    }
  }

  let moved = 0;
  let failed = 0;
  let done = 0;
  for (const asset of outside) {
    const result = byOriginal.get(asset.filePath);
    done += 1;
    onProgress?.(done, outside.length);
    if (!result || result.error) {
      failed += 1;
      continue;
    }
    if (result.path === asset.filePath) continue;
    await relinkAsset(asset.id, result.path, thumbs.get(result.path) ?? asset.thumbnailPath);
    moved += 1;
  }
  return { moved, failed };
}

export interface AdoptOutcome {
  /** 元のパス → 取り込み後のパス。移動しなかったものは同じ値が入る。 */
  moved: Map<string, string>;
  failures: { path: string; error: string }[];
}

/**
 * 取り込み対象の実ファイルをライブラリフォルダへ入れる。
 * `keep` のときは何もせず、パスをそのまま返す。
 */
export async function adoptIntoLibrary(
  paths: string[],
  settings: Settings,
): Promise<AdoptOutcome> {
  const moved = new Map<string, string>();
  if (paths.length === 0 || settings.importMode === "keep") {
    for (const p of paths) moved.set(p, p);
    return { moved, failures: [] };
  }

  const folder = await resolveLibraryFolder(settings);
  const results = await native.adoptFiles(paths, folder, settings.importMode === "move");

  const failures: { path: string; error: string }[] = [];
  for (const result of results) {
    moved.set(result.original, result.path);
    if (result.error) failures.push({ path: result.original, error: result.error });
  }
  return { moved, failures };
}
