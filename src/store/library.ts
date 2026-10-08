/**
 * ライブラリ（素材 / カテゴリ / タグ）の共有状態。
 * 2 つの窓が同じ DB を見るので、変更は `library:changed` イベントで相互に伝える。
 */
import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { loadLibrary } from "@/lib/db";
import { ACTIVE_PRESET, type CategorySeed } from "@/lib/presets";
import { createCategory } from "@/lib/db";
import { buildIndex, type SearchIndex } from "@/lib/search";
import type { Asset, Category, Tag } from "@/lib/types";

const CHANGED_EVENT = "library:changed";

interface LibraryState {
  assets: Asset[];
  categories: Category[];
  tags: Tag[];
  index: SearchIndex;
  status: "loading" | "ready" | "error";
  error: string | null;
  reload: () => Promise<void>;
}

const EMPTY_INDEX = buildIndex([]);

export const useLibrary = create<LibraryState>((set) => ({
  assets: [],
  categories: [],
  tags: [],
  index: EMPTY_INDEX,
  status: "loading",
  error: null,

  reload: async () => {
    try {
      const { assets, categories, tags } = await loadLibrary();
      set({
        assets,
        categories,
        tags,
        index: buildIndex(assets),
        status: "ready",
        error: null,
      });
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

/** 変更を保存したあとに呼ぶ。自分と相手の窓の両方が読み直す。 */
export async function notifyLibraryChanged() {
  await useLibrary.getState().reload();
  await emit(CHANGED_EVENT);
}

/** 他の窓からの変更通知を購読する。 */
export function watchLibraryChanges() {
  return listen(CHANGED_EVENT, () => {
    void useLibrary.getState().reload();
  });
}

/**
 * 初回起動時だけカテゴリの初期値を入れる。
 * どのプリセットを使うかは `src/lib/presets.ts` の `ACTIVE_PRESET` 一箇所で決まる（§4）。
 */
export async function seedCategoriesIfEmpty(existing: Category[]): Promise<boolean> {
  if (existing.length > 0) return false;

  const insert = async (seeds: CategorySeed[], parentId: number | null) => {
    for (const [i, seed] of seeds.entries()) {
      const id = await createCategory(seed.name, {
        icon: seed.icon,
        parentId,
        sortOrder: i,
      });
      if (seed.children?.length) await insert(seed.children, id);
    }
  };

  await insert(ACTIVE_PRESET, null);
  return true;
}
