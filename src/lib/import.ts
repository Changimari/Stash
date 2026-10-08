/**
 * 素材の取り込み。
 *
 * 流れ: パス収集 → probe（実寸・ハッシュ, Rust 並列）→ 重複除外 → サムネ生成（Rust 並列）
 *      → まとめて INSERT。重い処理はすべてネイティブ側にあるので UI は止まらない。
 */
import { addCategoryToAssets, countAssets, existingHashes, existingPaths, insertAssets } from "./db";
import { remainingAssetSlots } from "./gating";
import { adoptIntoLibrary } from "./library-folder";
import { native, type FileInfo } from "./native";
import { loadSettings, type Settings } from "./settings";
import type { AssetDraft } from "./types";

export type ImportPhase = "scanning" | "probing" | "thumbnails" | "saving" | "done";

export interface ImportProgress {
  phase: ImportPhase;
  done: number;
  total: number;
  /** 取り込み以外（再リンク等）で使う自由表示。指定があれば phase の文言より優先。 */
  label?: string;
}

export interface ImportSummary {
  added: number;
  /** 既に登録済み（パス一致 or 内容ハッシュ一致）だったもの */
  duplicates: number;
  /** 上限に達して入れられなかったもの */
  skippedByLimit: number;
  thumbnailFailures: number;
}

interface ImportOptions {
  onProgress?: (progress: ImportProgress) => void;
  /** 取り込んだ素材にまとめて付けるカテゴリ */
  categoryId?: number | null;
  /** 呼び出し側が既に持っていれば渡す（毎回ストアを読まないため）。 */
  settings?: Settings;
}

const EMPTY: ImportSummary = {
  added: 0,
  duplicates: 0,
  skippedByLimit: 0,
  thumbnailFailures: 0,
};

/** ファイルパスの配列から取り込む。Finder からのドロップ・ファイル選択の両方で使う。 */
export async function importPaths(
  paths: string[],
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const { onProgress } = options;
  if (paths.length === 0) return { ...EMPTY };

  onProgress?.({ phase: "probing", done: 0, total: paths.length });
  const probed = await native.probeFiles(paths, true);
  return ingest(probed, options);
}

/** フォルダを再帰的に走査して取り込む。 */
export async function importFolder(
  directory: string,
  options: ImportOptions & { recursive?: boolean; imagesOnly?: boolean } = {},
): Promise<ImportSummary> {
  const { onProgress, recursive = true, imagesOnly = false } = options;

  onProgress?.({ phase: "scanning", done: 0, total: 0 });
  const probed = await native.scanFolder(directory, recursive, imagesOnly);
  return ingest(probed, options);
}

/** probe 済みのファイル情報を DB に取り込む共通処理。 */
async function ingest(files: FileInfo[], options: ImportOptions): Promise<ImportSummary> {
  const { onProgress, categoryId } = options;
  const summary: ImportSummary = { ...EMPTY };
  if (files.length === 0) {
    onProgress?.({ phase: "done", done: 0, total: 0 });
    return summary;
  }

  // ── 重複を落とす（§7 重複検出: ファイルハッシュ） ──
  const [knownPaths, knownHashes] = await Promise.all([
    existingPaths(files.map((f) => f.path)),
    existingHashes(files.map((f) => f.hash ?? "")),
  ]);

  const seenHashes = new Set<string>();
  const fresh = files.filter((file) => {
    if (knownPaths.has(file.path)) return false;
    if (file.hash) {
      // 既存と重複、または今回の取り込み分の中で重複
      if (knownHashes.has(file.hash) || seenHashes.has(file.hash)) return false;
      seenHashes.add(file.hash);
    }
    return true;
  });
  summary.duplicates = files.length - fresh.length;

  // ── 上限（フリーミアム境界。MVP は無制限。§12） ──
  const slots = remainingAssetSlots(await countAssets());
  const accepted = Number.isFinite(slots) ? fresh.slice(0, slots) : fresh;
  summary.skippedByLimit = fresh.length - accepted.length;

  if (accepted.length === 0) {
    onProgress?.({ phase: "done", done: 0, total: 0 });
    return summary;
  }

  // ── 実ファイルをライブラリフォルダへ（既定は移動） ──
  // サムネより先にやる。サムネのキャッシュキーはパスを含むので、
  // 動かす前に焼くと取り込み直後に無駄な焼き直しが起きる。
  const settings = options.settings ?? (await loadSettings());
  onProgress?.({ phase: "saving", done: 0, total: accepted.length, label: "ファイルを整理中…" });
  const adopted = await adoptIntoLibrary(
    accepted.map((f) => f.path),
    settings,
  );
  for (const file of accepted) {
    file.path = adopted.moved.get(file.path) ?? file.path;
  }

  // ── サムネ生成（画像のみ） ──
  onProgress?.({ phase: "thumbnails", done: 0, total: accepted.length });
  const imagePaths = accepted.filter((f) => f.kind === "image").map((f) => f.path);
  const thumbs = new Map<string, string>();
  if (imagePaths.length > 0) {
    const results = await native.generateThumbnails(imagePaths);
    for (const result of results) {
      if (result.thumbnail) thumbs.set(result.path, result.thumbnail);
      else summary.thumbnailFailures += 1;
    }
  }

  // ── 保存 ──
  onProgress?.({ phase: "saving", done: 0, total: accepted.length });
  const drafts: AssetDraft[] = accepted.map((file) => ({
    name: file.name,
    filePath: file.path,
    type: file.kind === "image" ? "image" : "file",
    thumbnailPath: thumbs.get(file.path) ?? null,
    // caption は最初は空。管理画面で入れてもらう（§7: 入力欄を目立つ位置に）。
    metadata: { ext: file.ext },
    fileHash: file.hash,
    fileSize: file.size,
    width: file.width,
    height: file.height,
  }));

  summary.added = await insertAssets(drafts);

  if (categoryId != null && summary.added > 0) {
    const paths = drafts.map((d) => d.filePath);
    const ids = await idsForPaths(paths);
    await addCategoryToAssets(ids, categoryId);
  }

  onProgress?.({ phase: "done", done: summary.added, total: accepted.length });
  return summary;
}

async function idsForPaths(paths: string[]): Promise<number[]> {
  const { getDb } = await import("./db");
  const db = await getDb();
  const ids: number[] = [];
  for (let i = 0; i < paths.length; i += 400) {
    const chunk = paths.slice(i, i + 400);
    const placeholders = chunk.map((_, n) => `$${n + 1}`).join(", ");
    const rows = await db.select<{ id: number }[]>(
      `SELECT id FROM assets WHERE file_path IN (${placeholders})`,
      chunk,
    );
    rows.forEach((r) => ids.push(r.id));
  }
  return ids;
}
