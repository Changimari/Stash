/**
 * 機能ゲート（フリーミアム境界）。§12 のとおり **1 箇所に集約** する。
 *
 * MVP では何も制限しない（`ENFORCED = false`）。将来ライセンス層を差し込むときは
 * `currentTier()` の実装だけを本物に差し替えればよく、呼び出し側は変えなくてよい。
 * 制限を判定したい場所からは必ずこのモジュール経由で聞くこと。
 */

export type Tier = "free" | "pro";

export type Feature =
  | "captionCompose" // キャプション合成コピー
  | "customHotkey" // ホットキーの変更
  | "bulkImport" // フォルダ一括取り込み
  | "categories"; // カテゴリのネスト管理

interface Plan {
  maxAssets: number;
  features: Record<Feature, boolean>;
}

/** 無料 / 有料の線引き。数値はここを触るだけで変えられる。 */
export const PLANS: Record<Tier, Plan> = {
  free: {
    maxAssets: 200,
    features: {
      captionCompose: true,
      customHotkey: true,
      bulkImport: false,
      categories: true,
    },
  },
  pro: {
    maxAssets: Number.POSITIVE_INFINITY,
    features: {
      captionCompose: true,
      customHotkey: true,
      bulkImport: true,
      categories: true,
    },
  },
};

/** MVP は制限なし。ライセンス層を入れる段階で true にする。 */
const ENFORCED = false;

/** 将来ここをライセンス検証の結果に差し替える。 */
export function currentTier(): Tier {
  return "pro";
}

export function can(feature: Feature): boolean {
  if (!ENFORCED) return true;
  return PLANS[currentTier()].features[feature];
}

export function assetLimit(): number {
  if (!ENFORCED) return Number.POSITIVE_INFINITY;
  return PLANS[currentTier()].maxAssets;
}

/** あと何件登録できるか。取り込み前のチェックに使う。 */
export function remainingAssetSlots(currentCount: number): number {
  const limit = assetLimit();
  if (limit === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - currentCount);
}
