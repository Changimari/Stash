/**
 * カテゴリの初期値（seed）。
 *
 * ★ ここが「汎用版 ↔ AV 特化版」の差し替えポイント（§4 拡張ポイント）。
 * `ACTIVE_PRESET` を差し替えるだけで特化版になる。DB スキーマは一切変わらない。
 * 初回起動時（カテゴリが 0 件のとき）にだけ投入される。
 */

export interface CategorySeed {
  name: string;
  icon?: string;
  children?: CategorySeed[];
}

/** 汎用の素材ライブラリとして起動したときの初期カテゴリ。 */
export const GENERIC_PRESET: CategorySeed[] = [
  { name: "画像", icon: "photo" },
  { name: "ドキュメント", icon: "doc" },
  { name: "アイコン", icon: "sparkle" },
];

/**
 * AV 業界向け（将来の特化版で `ACTIVE_PRESET` に差し替える想定）。
 * MVP では同梱しないが、構造だけ先に用意しておく（§8 含まないもの）。
 */
export const AV_PRESET: CategorySeed[] = [
  { name: "ロゴ", icon: "sparkle" },
  {
    name: "系統図パーツ",
    icon: "diagram",
    children: [{ name: "映像" }, { name: "音声" }, { name: "制御" }],
  },
  { name: "機器写真", icon: "photo" },
  { name: "型番テキスト", icon: "textformat" },
];

export const ACTIVE_PRESET = GENERIC_PRESET;
