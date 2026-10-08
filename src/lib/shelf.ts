/**
 * Shelf（一時置き場）。
 *
 * ライブラリとは別物として扱う。ライブラリは「登録した素材」、Shelf は「いま運んでいる途中の物」。
 * だから SQLite ではなく専用のストアに置き、消えても困らないものとして扱う。
 *
 * 実ファイルはコピーしない。Shelf が持つのは絶対パスへの参照だけで、
 * 置いても取り出しても元ファイルには一切触れない。
 */
import { emit, listen } from "@tauri-apps/api/event";
import { load, type Store } from "@tauri-apps/plugin-store";
import { native } from "./native";

export interface ShelfItem {
  /** パスをそのまま id にする。同じファイルは二重に置けない。 */
  path: string;
  name: string;
  /** 'image' | 'file' */
  kind: string;
  size: number;
  thumbnailPath: string | null;
  addedAt: string;
}

const STORE_FILE = "shelf.json";
const KEY = "items";
const CHANGED = "shelf:changed";

/** 預かりすぎると窓に収まらないので上限を設ける。古いものから押し出す。 */
const MAX_ITEMS = 60;

let store: Store | null = null;
async function getStore(): Promise<Store> {
  store ??= await load(STORE_FILE, { autoSave: false });
  return store;
}

export async function readShelf(): Promise<ShelfItem[]> {
  try {
    const s = await getStore();
    return (await s.get<ShelfItem[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

async function writeShelf(items: ShelfItem[]): Promise<void> {
  const s = await getStore();
  await s.set(KEY, items);
  await s.save();
  // 他の窓（Shelf・オーバーレイ・管理画面）へ反映させる
  await emit(CHANGED);
}

/** Shelf の変化を監視する。戻り値を呼ぶと解除。 */
export function watchShelf(onChange: () => void): () => void {
  const pending = listen(CHANGED, onChange);
  return () => void pending.then((un) => un());
}

/**
 * ファイルを Shelf に預ける。すでにあるものは無視し、置いた件数を返す。
 * サムネは Rust 側で並列に焼く。
 */
export async function putOnShelf(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;

  const current = await readShelf();
  const known = new Set(current.map((i) => i.path));
  const fresh = paths.filter((p) => !known.has(p));
  if (fresh.length === 0) return 0;

  const probed = await native.probeFiles(fresh, false);
  const images = probed.filter((f) => f.kind === "image").map((f) => f.path);
  const thumbs = new Map<string, string>();
  if (images.length > 0) {
    for (const result of await native.generateThumbnails(images, 256)) {
      if (result.thumbnail) thumbs.set(result.path, result.thumbnail);
    }
  }

  const addedAt = new Date().toISOString();
  const added: ShelfItem[] = probed.map((f) => ({
    path: f.path,
    name: f.name,
    kind: f.kind,
    size: f.size,
    thumbnailPath: thumbs.get(f.path) ?? null,
    addedAt,
  }));

  // 新しいものを上に積む
  await writeShelf([...added, ...current].slice(0, MAX_ITEMS));
  return added.length;
}

export async function removeFromShelf(paths: string[]): Promise<void> {
  const drop = new Set(paths);
  const current = await readShelf();
  await writeShelf(current.filter((i) => !drop.has(i.path)));
}

export async function clearShelf(): Promise<void> {
  await writeShelf([]);
}
