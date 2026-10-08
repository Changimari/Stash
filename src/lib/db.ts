/**
 * SQLite への唯一の入口（DAO）。SQL はこのファイルの外に書かないこと。
 *
 * スキーマ定義とマイグレーションは Rust 側（`src-tauri/src/db.rs`）が持つ。
 * こちらは読み書きだけを担当する。
 */
import Database from "@tauri-apps/plugin-sql";
import type { Asset, AssetDraft, AssetMetadata, AssetType, Category, Tag } from "./types";

/** src-tauri/src/db.rs の DB_URL と必ず一致させること。 */
const DB_URL = "sqlite:stash.db";

let handle: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!handle) {
    handle = Database.load(DB_URL);
  }
  return handle;
}

// ─────────────────────────── 行 → ドメイン変換 ───────────────────────────

interface AssetRow {
  id: number;
  name: string;
  file_path: string;
  type: string;
  thumbnail_path: string | null;
  metadata: string;
  file_hash: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseMetadata(raw: string): AssetMetadata {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as AssetMetadata) : {};
  } catch {
    // 壊れた JSON でライブラリ全体が読めなくなる方が損害が大きい
    return {};
  }
}

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    name: row.name,
    filePath: row.file_path,
    type: (row.type as AssetType) ?? "file",
    thumbnailPath: row.thumbnail_path,
    metadata: parseMetadata(row.metadata),
    fileHash: row.file_hash,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    categoryIds: [],
    tagIds: [],
    tagNames: [],
    categoryNames: [],
  };
}

const nowIso = () => new Date().toISOString();

/** `$1, $2, …` を n 個ぶん組み立てる。 */
function placeholders(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, i) => `$${offset + i + 1}`).join(", ");
}

// ─────────────────────────── 読み出し ───────────────────────────

/**
 * 全素材とその関連（タグ / カテゴリ）を一括で取る。
 * 数千件までは 3 クエリで引いて JS 側で束ねるのが最速。
 */
export async function loadLibrary(): Promise<{
  assets: Asset[];
  categories: Category[];
  tags: Tag[];
}> {
  const db = await getDb();

  const [assetRows, categoryRows, tagRows, assetTagRows, assetCategoryRows] =
    await Promise.all([
      db.select<AssetRow[]>(
        `SELECT * FROM assets ORDER BY use_count DESC, last_used_at DESC, created_at DESC`,
      ),
      db.select<
        {
          id: number;
          name: string;
          icon: string | null;
          color: string | null;
          parent_id: number | null;
          sort_order: number;
        }[]
      >(`SELECT * FROM categories ORDER BY sort_order, name`),
      db.select<{ id: number; name: string }[]>(`SELECT id, name FROM tags ORDER BY name`),
      db.select<{ asset_id: number; tag_id: number }[]>(`SELECT * FROM asset_tags`),
      db.select<{ asset_id: number; category_id: number }[]>(`SELECT * FROM asset_categories`),
    ]);

  const categories: Category[] = categoryRows.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    parentId: c.parent_id,
    sortOrder: c.sort_order,
  }));
  const tags: Tag[] = tagRows;

  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const assets = assetRows.map(toAsset);
  const byId = new Map(assets.map((a) => [a.id, a]));

  for (const link of assetTagRows) {
    const asset = byId.get(link.asset_id);
    if (!asset) continue;
    asset.tagIds.push(link.tag_id);
    const name = tagName.get(link.tag_id);
    if (name) asset.tagNames.push(name);
  }
  for (const link of assetCategoryRows) {
    const asset = byId.get(link.asset_id);
    if (!asset) continue;
    asset.categoryIds.push(link.category_id);
    const name = categoryName.get(link.category_id);
    if (name) asset.categoryNames.push(name);
  }

  return { assets, categories, tags };
}

// ─────────────────────────── 素材 ───────────────────────────

/** 既に登録済みのパス集合。取り込み時の重複判定に使う。 */
export async function existingPaths(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const db = await getDb();
  const found = new Set<string>();
  // SQLite の変数上限（既定 999）に収まるよう小分けにする
  for (let i = 0; i < paths.length; i += 400) {
    const chunk = paths.slice(i, i + 400);
    const rows = await db.select<{ file_path: string }[]>(
      `SELECT file_path FROM assets WHERE file_path IN (${placeholders(chunk.length)})`,
      chunk,
    );
    rows.forEach((r) => found.add(r.file_path));
  }
  return found;
}

/** 内容が同じファイル（ハッシュ一致）の集合。パスが違っても重複として検出する。 */
export async function existingHashes(hashes: string[]): Promise<Set<string>> {
  const clean = hashes.filter(Boolean);
  if (clean.length === 0) return new Set();
  const db = await getDb();
  const found = new Set<string>();
  for (let i = 0; i < clean.length; i += 400) {
    const chunk = clean.slice(i, i + 400);
    const rows = await db.select<{ file_hash: string }[]>(
      `SELECT file_hash FROM assets WHERE file_hash IN (${placeholders(chunk.length)})`,
      chunk,
    );
    rows.forEach((r) => found.add(r.file_hash));
  }
  return found;
}

const ASSET_COLUMNS = 10;

/** まとめて登録する。1 行ずつ INSERT すると取り込みが目に見えて遅くなる。 */
export async function insertAssets(drafts: AssetDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const db = await getDb();
  let inserted = 0;

  // 1 文 あたりのバインド変数が SQLite の上限を超えないようチャンク分割
  const perChunk = Math.floor(900 / ASSET_COLUMNS);
  for (let i = 0; i < drafts.length; i += perChunk) {
    const chunk = drafts.slice(i, i + perChunk);
    const values: unknown[] = [];
    const rows = chunk.map((d, index) => {
      const ts = nowIso();
      values.push(
        d.name,
        d.filePath,
        d.type,
        d.thumbnailPath ?? null,
        JSON.stringify(d.metadata ?? {}),
        d.fileHash ?? null,
        d.fileSize ?? null,
        d.width ?? null,
        d.height ?? null,
        ts,
      );
      return `(${placeholders(ASSET_COLUMNS, index * ASSET_COLUMNS)})`;
    });

    const result = await db.execute(
      `INSERT OR IGNORE INTO assets
         (name, file_path, type, thumbnail_path, metadata, file_hash, file_size, width, height, created_at)
       VALUES ${rows.join(", ")}`,
      values,
    );
    inserted += result.rowsAffected;
  }
  return inserted;
}

export interface AssetPatch {
  name?: string;
  metadata?: AssetMetadata;
  thumbnailPath?: string | null;
  type?: AssetType;
}

export async function updateAsset(id: number, patch: AssetPatch): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.name !== undefined) {
    values.push(patch.name);
    sets.push(`name = $${values.length}`);
  }
  if (patch.metadata !== undefined) {
    values.push(JSON.stringify(patch.metadata));
    sets.push(`metadata = $${values.length}`);
  }
  if (patch.thumbnailPath !== undefined) {
    values.push(patch.thumbnailPath);
    sets.push(`thumbnail_path = $${values.length}`);
  }
  if (patch.type !== undefined) {
    values.push(patch.type);
    sets.push(`type = $${values.length}`);
  }
  if (sets.length === 0) return;

  values.push(nowIso());
  sets.push(`updated_at = $${values.length}`);
  values.push(id);

  await db.execute(`UPDATE assets SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
}

/** ライブラリから素材を外す。元ファイルには一切触れない。 */
export async function deleteAssets(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const list = `(${placeholders(ids.length)})`;
  // CASCADE に頼らず中間テーブルを先に片付ける（deleteCategory と同じ理由）
  await db.execute(`DELETE FROM asset_tags WHERE asset_id IN ${list}`, ids);
  await db.execute(`DELETE FROM asset_categories WHERE asset_id IN ${list}`, ids);
  await db.execute(`DELETE FROM assets WHERE id IN ${list}`, ids);
}

/** 使用実績を記録して並び順に反映させる（§6-4）。 */
export async function recordUse(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE assets SET use_count = use_count + 1, last_used_at = $1 WHERE id = $2`,
    [nowIso(), id],
  );
}

export async function countAssets(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM assets`);
  return rows[0]?.n ?? 0;
}

// ─────────────────────────── カテゴリ ───────────────────────────

export async function createCategory(
  name: string,
  options: { icon?: string; color?: string; parentId?: number | null; sortOrder?: number } = {},
): Promise<number> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO categories (name, icon, color, parent_id, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      name,
      options.icon ?? null,
      options.color ?? null,
      options.parentId ?? null,
      options.sortOrder ?? 0,
    ],
  );
  const rows = await db.select<{ id: number }[]>(
    `SELECT id FROM categories WHERE name = $1 AND IFNULL(parent_id, 0) = IFNULL($2, 0)`,
    [name, options.parentId ?? null],
  );
  return rows[0]?.id ?? 0;
}

export async function renameCategory(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE categories SET name = $1 WHERE id = $2`, [name, id]);
}

/**
 * カテゴリを配下ごと削除する。素材そのものには触れない。
 *
 * ON DELETE CASCADE には **あえて頼らない**。CASCADE は `PRAGMA foreign_keys = ON` が
 * 前提で、これは接続ごとの設定なので、コネクションプールの引きによっては効かず
 * 孤立行が静かに残る。再帰 CTE で自前に消せばどちらでも確実に片付く。
 */
export async function deleteCategory(id: number): Promise<void> {
  const db = await getDb();
  const subtree = `
    WITH RECURSIVE subtree(id) AS (
      SELECT $1
      UNION ALL
      SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
    )`;

  await db.execute(
    `${subtree} DELETE FROM asset_categories WHERE category_id IN (SELECT id FROM subtree)`,
    [id],
  );
  await db.execute(
    `${subtree} DELETE FROM categories WHERE id IN (SELECT id FROM subtree)`,
    [id],
  );
}

export async function setAssetCategories(assetId: number, categoryIds: number[]): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM asset_categories WHERE asset_id = $1`, [assetId]);
  if (categoryIds.length === 0) return;
  const values: unknown[] = [];
  const rows = categoryIds.map((cid, i) => {
    values.push(assetId, cid);
    return `($${i * 2 + 1}, $${i * 2 + 2})`;
  });
  await db.execute(
    `INSERT OR IGNORE INTO asset_categories (asset_id, category_id) VALUES ${rows.join(", ")}`,
    values,
  );
}

/** 複数素材へまとめてカテゴリを追加する（既存の割り当ては消さない）。 */
export async function addCategoryToAssets(assetIds: number[], categoryId: number): Promise<void> {
  if (assetIds.length === 0) return;
  const db = await getDb();
  for (let i = 0; i < assetIds.length; i += 400) {
    const chunk = assetIds.slice(i, i + 400);
    const values: unknown[] = [];
    const rows = chunk.map((aid, n) => {
      values.push(aid, categoryId);
      return `($${n * 2 + 1}, $${n * 2 + 2})`;
    });
    await db.execute(
      `INSERT OR IGNORE INTO asset_categories (asset_id, category_id) VALUES ${rows.join(", ")}`,
      values,
    );
  }
}

/** 複数素材からカテゴリを外す。 */
export async function removeCategoryFromAssets(
  assetIds: number[],
  categoryId: number,
): Promise<void> {
  if (assetIds.length === 0) return;
  const db = await getDb();
  for (let i = 0; i < assetIds.length; i += 400) {
    const chunk = assetIds.slice(i, i + 400);
    await db.execute(
      `DELETE FROM asset_categories
       WHERE category_id = $1 AND asset_id IN (${placeholders(chunk.length, 1)})`,
      [categoryId, ...chunk],
    );
  }
}

/** 複数素材へまとめてタグを付ける（既存のタグは消さない）。 */
export async function addTagsToAssets(assetIds: number[], tagNames: string[]): Promise<void> {
  const map = await ensureTags(tagNames);
  const tagIds = [...map.values()];
  if (assetIds.length === 0 || tagIds.length === 0) return;

  const db = await getDb();
  const pairs = assetIds.flatMap((aid) => tagIds.map((tid) => [aid, tid] as const));
  for (let i = 0; i < pairs.length; i += 400) {
    const chunk = pairs.slice(i, i + 400);
    const values: unknown[] = [];
    const rows = chunk.map((pair, n) => {
      values.push(pair[0], pair[1]);
      return `($${n * 2 + 1}, $${n * 2 + 2})`;
    });
    await db.execute(
      `INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES ${rows.join(", ")}`,
      values,
    );
  }
}

/**
 * 素材の名前をそのままキャプションに入れる（一括）。
 * AV 用途では型番がファイル名に入っていることが多く、入力コストが一番大きいので
 * 「名前 → キャプション」の一括流し込みだけ用意しておく。
 * 既にキャプションがあるものは `overwrite` が false なら触らない。
 */
export async function fillCaptionsFromName(
  assets: { id: number; name: string; metadata: AssetMetadata }[],
  overwrite: boolean,
): Promise<number> {
  let updated = 0;
  for (const asset of assets) {
    const current = asset.metadata.caption?.trim();
    if (current && !overwrite) continue;
    if (current === asset.name) continue;
    await updateAsset(asset.id, {
      metadata: { ...asset.metadata, caption: asset.name },
    });
    updated += 1;
  }
  return updated;
}

/** 素材の実ファイルの場所を差し替える（再リンク）。 */
export async function relinkAsset(
  id: number,
  filePath: string,
  thumbnailPath: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE assets SET file_path = $1, thumbnail_path = $2, updated_at = $3 WHERE id = $4`,
    [filePath, thumbnailPath, nowIso(), id],
  );
}

// ─────────────────────────── タグ ───────────────────────────

/** タグ名から id を引く。無ければ作る。 */
export async function ensureTags(names: string[]): Promise<Map<string, number>> {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const map = new Map<string, number>();
  if (clean.length === 0) return map;

  const db = await getDb();
  const values: unknown[] = [];
  const rows = clean.map((n, i) => {
    values.push(n);
    return `($${i + 1})`;
  });
  await db.execute(`INSERT OR IGNORE INTO tags (name) VALUES ${rows.join(", ")}`, values);

  const found = await db.select<{ id: number; name: string }[]>(
    `SELECT id, name FROM tags WHERE name IN (${placeholders(clean.length)})`,
    clean,
  );
  found.forEach((t) => map.set(t.name, t.id));
  return map;
}

export async function setAssetTags(assetId: number, tagNames: string[]): Promise<void> {
  const db = await getDb();
  const map = await ensureTags(tagNames);
  await db.execute(`DELETE FROM asset_tags WHERE asset_id = $1`, [assetId]);
  const ids = [...map.values()];
  if (ids.length === 0) return;

  const values: unknown[] = [];
  const rows = ids.map((tid, i) => {
    values.push(assetId, tid);
    return `($${i * 2 + 1}, $${i * 2 + 2})`;
  });
  await db.execute(
    `INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES ${rows.join(", ")}`,
    values,
  );
}

/** どの素材にも付いていないタグを掃除する。 */
export async function pruneOrphanTags(): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM asset_tags)`,
  );
}
