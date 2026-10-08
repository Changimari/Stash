/**
 * 検索インデックスと並び替え。
 *
 * 現在は Fuse.js（クライアント側ファジー検索）。素材が数万件規模になったら
 * SQLite FTS5 へ差し替えられるよう、外に見せるのは `buildIndex` / `search` の
 * 2 つだけに絞ってある。呼び出し側は Fuse を直接知らない。
 */
import Fuse, { type IFuseOptions } from "fuse.js";
import type { LibrarySort } from "./settings";
import type { Asset } from "./types";

/** Fuse に食わせる 1 件ぶんの平坦なドキュメント。 */
interface SearchDoc {
  id: number;
  name: string;
  caption: string;
  tags: string;
  categories: string;
  /** metadata の「値」だけを連結したもの（§4: metadata もインデックス対象） */
  meta: string;
  ext: string;
}

const FUSE_OPTIONS: IFuseOptions<SearchDoc> = {
  includeScore: true,
  ignoreLocation: true, // 文字列のどこに一致しても拾う（型番の部分一致に効く）
  threshold: 0.38,
  minMatchCharLength: 1,
  keys: [
    { name: "name", weight: 0.42 },
    { name: "caption", weight: 0.26 },
    { name: "tags", weight: 0.14 },
    { name: "meta", weight: 0.1 },
    { name: "categories", weight: 0.05 },
    { name: "ext", weight: 0.03 },
  ],
};

/** metadata から検索に使えそうな値だけを拾って 1 本の文字列にする。 */
function flattenMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || value == null) return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
    } else if (Array.isArray(value)) {
      value.forEach((v) => visit(v, depth + 1));
    } else if (typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach((v) => visit(v, depth + 1));
    }
  };
  visit(metadata, 0);
  return parts.join(" ");
}

function toDoc(asset: Asset): SearchDoc {
  return {
    id: asset.id,
    name: asset.name,
    caption: asset.metadata.caption ?? "",
    tags: asset.tagNames.join(" "),
    categories: asset.categoryNames.join(" "),
    meta: flattenMetadata(asset.metadata),
    ext: asset.metadata.ext ?? "",
  };
}

export interface SearchIndex {
  readonly assets: Asset[];
  search(query: string): Asset[];
}

/**
 * 使用頻度で押し上げる係数。Fuse のスコアは 0 が最良なので、
 * よく使う素材ほどスコアを小さく（＝上位に）する。
 * 一致度を壊さない程度に、控えめに効かせる。
 */
function usageBoost(asset: Asset): number {
  const recency = asset.lastUsedAt
    ? Math.max(0, 1 - (Date.now() - Date.parse(asset.lastUsedAt)) / (1000 * 60 * 60 * 24 * 30))
    : 0;
  return 1 + Math.log1p(asset.useCount) * 0.18 + recency * 0.12;
}

/** 検索語が無いときの並び。よく使うもの・最近使ったものが上（§6-4）。 */
function sortByUsage(assets: Asset[]): Asset[] {
  return [...assets].sort((a, b) => {
    if (b.useCount !== a.useCount) return b.useCount - a.useCount;
    const at = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const bt = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    if (bt !== at) return bt - at;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

/**
 * 管理画面の並び替え。検索の有無に関わらず、選んだ順序を必ず適用する
 * （Finder と同じ挙動。検索したら勝手に順序が変わる方が戸惑う）。
 */
export function sortAssets(
  assets: Asset[],
  key: LibrarySort,
  descending: boolean,
): Asset[] {
  const dir = descending ? -1 : 1;
  const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);

  const compare = (a: Asset, b: Asset): number => {
    switch (key) {
      case "name":
        // 数字を含む型番が 1, 2, 10 の順に並ぶよう自然順で比べる
        return a.name.localeCompare(b.name, "ja", { numeric: true, sensitivity: "base" });
      case "useCount":
        return a.useCount - b.useCount;
      case "lastUsed":
        return time(a.lastUsedAt) - time(b.lastUsedAt);
      case "size":
        return (a.fileSize ?? 0) - (b.fileSize ?? 0);
      case "added":
      default:
        return time(a.createdAt) - time(b.createdAt);
    }
  };

  return [...assets].sort((a, b) => {
    const result = compare(a, b);
    // 同着は名前で固定して、並びがちらつかないようにする
    return result !== 0
      ? result * dir
      : a.name.localeCompare(b.name, "ja", { numeric: true });
  });
}

export function buildIndex(assets: Asset[]): SearchIndex {
  const docs = assets.map(toDoc);
  const fuse = new Fuse(docs, FUSE_OPTIONS);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const fallback = sortByUsage(assets);

  return {
    assets,
    search(query: string): Asset[] {
      const trimmed = query.trim();
      if (!trimmed) return fallback;

      return fuse
        .search(trimmed)
        .map((hit) => {
          const asset = byId.get(hit.item.id);
          if (!asset) return null;
          // Fuse は 0 が最良。よく使う素材ほどスコアを割り引いて上位に出す。
          const score = (hit.score ?? 1) / usageBoost(asset);
          return { asset, score };
        })
        .filter((x): x is { asset: Asset; score: number } => x !== null)
        .sort((a, b) => a.score - b.score)
        .map((x) => x.asset);
    },
  };
}
