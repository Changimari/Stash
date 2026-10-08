//! SQLite のスキーマとマイグレーション定義。
//!
//! ## 拡張ポイント（重要）
//! - `assets.metadata` は JSON テキストの自由領域。`caption`（合成コピー用の型番/名称）は
//!   MVP から使用する。将来の AV 特化フィールド（manufacturer / model_no / diagram_type …）も
//!   **マイグレーションなしで** ここに足せる。列を増やさないこと。
//! - カテゴリの初期値（seed）はこの層では持たない。フロントの `src/lib/presets.ts` が
//!   初回起動時に投入する。汎用版 ↔ AV 特化版の差し替えはそのファイル 1 つで完結する。
//! - `assets.type` は `'image' | 'file'`。将来 `'text'`（テキストスニペット）を足せるよう
//!   CHECK 制約は付けていない。

use tauri_plugin_sql::{Migration, MigrationKind};

/// フロント（`src/lib/db.ts`）とこの値を必ず一致させること。
pub const DB_URL: &str = "sqlite:stash.db";

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_core_schema",
        kind: MigrationKind::Up,
        sql: r#"
PRAGMA foreign_keys = ON;

-- 日時はすべて ISO8601 文字列（UTC）を TEXT で保持する。
-- SQLite に真の DATETIME 型は無く、TEXT が sqlx との相性も最良のため。
CREATE TABLE IF NOT EXISTS assets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  file_path      TEXT    NOT NULL,
  type           TEXT    NOT NULL DEFAULT 'file',
  thumbnail_path TEXT,
  -- 任意フィールド置き場（JSON）。caption / 将来の AV 特化項目はすべてここ。
  metadata       TEXT    NOT NULL DEFAULT '{}',
  -- 重複検出用の SHA-256（取り込み時に算出）
  file_hash      TEXT,
  file_size      INTEGER,
  width          INTEGER,
  height         INTEGER,
  use_count      INTEGER NOT NULL DEFAULT 0,
  last_used_at   TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_file_path ON assets(file_path);
CREATE INDEX IF NOT EXISTS idx_assets_file_hash ON assets(file_hash);
CREATE INDEX IF NOT EXISTS idx_assets_rank ON assets(use_count DESC, last_used_at DESC);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  icon       TEXT,
  color      TEXT,
  parent_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 同じ親の下に同名カテゴリを作らせない（親が NULL のときは 0 として扱う）
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique
  ON categories(IFNULL(parent_id, 0), name);

CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS asset_categories (
  asset_id    INTEGER NOT NULL REFERENCES assets(id)     ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_categories_category ON asset_categories(category_id);

CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (asset_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);
"#,
    }]
}
