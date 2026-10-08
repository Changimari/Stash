/** 素材の種別。将来 'text'（テキストスニペット）を足せるよう分岐は開けてある（§4）。 */
export type AssetType = "image" | "file" | "text";

/**
 * `assets.metadata` の中身。**スキーマ変更なしで項目を足せる自由領域**。
 *
 * MVP で使うのは `caption` のみ（合成コピー用の型番/名称。§6-1）。
 * AV 特化版はここに `manufacturer` / `modelNo` / `diagramType` などを
 * 足していく。マイグレーションは不要。
 */
export interface AssetMetadata {
  /** 合成コピーの帯に出る文字列。未設定なら name にフォールバックする。 */
  caption?: string;
  /** 2 行目以降（メーカー名など）。合成コピーの拡張余地（§6-1）。 */
  captionLines?: string[];
  /** 自由メモ。検索対象に含まれる。 */
  note?: string;
  /** 取り込み時の拡張子。検索の手がかりとして持っておく。 */
  ext?: string;

  // ── ここから下は将来の AV 特化フィールドの置き場 ──
  // manufacturer?: string;
  // modelNo?: string;
  // diagramType?: string;

  [key: string]: unknown;
}

export interface Asset {
  id: number;
  name: string;
  filePath: string;
  type: AssetType;
  thumbnailPath: string | null;
  metadata: AssetMetadata;
  fileHash: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;

  /** 中間テーブルを解決した付随情報（DAO が埋める） */
  categoryIds: number[];
  tagIds: number[];
  tagNames: string[];
  categoryNames: string[];
}

export interface Category {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  parentId: number | null;
  sortOrder: number;
}

export interface Tag {
  id: number;
  name: string;
}

/** 新規作成時に渡す値。id や日時は DB 側で埋まる。 */
export interface AssetDraft {
  name: string;
  filePath: string;
  type: AssetType;
  thumbnailPath?: string | null;
  metadata?: AssetMetadata;
  fileHash?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
}

/** 素材に対して実行できる操作。既定アクションの設定値としても使う（§7）。 */
export type AssetAction = "drag" | "copy" | "copyWithCaption";
