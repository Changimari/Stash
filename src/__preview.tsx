/**
 * 開発時だけのデザイン確認ページ（本番ビルドには含まれない）。
 * Tauri のブリッジをモックして、実物と同じコンポーネントをブラウザで描かせる。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";

// ─────────────── Tauri ブリッジのモック（import より先に入れる） ───────────────

const SAMPLE = [
  { id: 1, name: "PTZ-CAM-X70", caption: "PTZ-CAM-X70", w: 900, h: 600, hue: 210 },
  { id: 2, name: "DSP-MX8100", caption: "DSP-MX8100 / 8ch DSP", w: 1200, h: 700, hue: 232 },
  { id: 3, name: "LED-WALL-P1.9", caption: "LED-WALL-P1.9", w: 1000, h: 640, hue: 258 },
  { id: 4, name: "MTR-BAR-A20", caption: "", w: 860, h: 520, hue: 196 },
  { id: 5, name: "SW-MATRIX-8X8", caption: "SW-MATRIX-8X8 マトリクススイッチャ", w: 1100, h: 620, hue: 172 },
  { id: 6, name: "MIC-CEIL-C300", caption: "MIC-CEIL-C300", w: 760, h: 760, hue: 24 },
  { id: 7, name: "acme-logo", caption: "ACME AV ロゴ", w: 600, h: 200, hue: 208 },
  { id: 8, name: "会議室レイアウト", caption: "", w: 1400, h: 900, hue: 140 },
  { id: 9, name: "納品仕様書", caption: "", w: 0, h: 0, hue: 0, file: true },
];

function fakeImage(width: number, height: number, hue: number, label: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width || 400;
  canvas.height = height || 300;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, `hsl(${hue} 26% 42%)`);
  g.addColorStop(1, `hsl(${hue} 24% 24%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#D8DEE8";
  ctx.beginPath();
  ctx.roundRect(w * 0.12, h * 0.32, w * 0.76, h * 0.4, 16);
  ctx.fill();
  ctx.fillStyle = "#78849699";
  ctx.beginPath();
  ctx.roundRect(w * 0.16, h * 0.38, w * 0.32, h * 0.28, 10);
  ctx.fill();
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = "#4A5466";
    ctx.beginPath();
    ctx.arc(w * 0.58 + i * w * 0.06, h * 0.52, Math.min(14, w * 0.016), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#E8EEF6";
  ctx.font = `${Math.round(w * 0.035)}px -apple-system, sans-serif`;
  ctx.fillText(label, w * 0.13, h * 0.86);
  return canvas;
}

async function pngBytes(width: number, height: number, hue: number, label: string) {
  const canvas = fakeImage(width, height, hue, label);
  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  return blob.arrayBuffer();
}

const nowIso = new Date().toISOString();

function mockSelect(query: string): unknown[] {
  if (query.includes("FROM assets")) {
    return SAMPLE.map((s, i) => ({
      id: s.id,
      name: s.name,
      file_path: `/Users/demo/materials/${s.name}.${s.file ? "pdf" : "png"}`,
      type: s.file ? "file" : "image",
      thumbnail_path: s.file ? null : `mock://${s.id}`,
      metadata: JSON.stringify({ caption: s.caption || undefined, ext: s.file ? "pdf" : "png" }),
      file_hash: `hash${s.id}`,
      file_size: 240_000 + i * 51_000,
      width: s.w || null,
      height: s.h || null,
      use_count: [12, 8, 6, 3, 2, 1, 9, 0, 0][i] ?? 0,
      last_used_at: i < 4 ? nowIso : null,
      created_at: nowIso,
      updated_at: nowIso,
    }));
  }
  if (query.includes("FROM categories")) {
    return [
      { id: 1, name: "機器写真", icon: "photo", color: null, parent_id: null, sort_order: 0 },
      { id: 2, name: "ロゴ", icon: "sparkle", color: null, parent_id: null, sort_order: 1 },
      { id: 3, name: "系統図パーツ", icon: "diagram", color: null, parent_id: null, sort_order: 2 },
      { id: 4, name: "映像", icon: null, color: null, parent_id: 3, sort_order: 0 },
      { id: 5, name: "ドキュメント", icon: "doc", color: null, parent_id: null, sort_order: 3 },
    ];
  }
  if (query.includes("FROM tags")) {
    return [
      { id: 1, name: "カメラ" },
      { id: 2, name: "音響" },
      { id: 3, name: "納品済み" },
    ];
  }
  if (query.includes("FROM asset_tags")) {
    return [
      { asset_id: 1, tag_id: 1 },
      { asset_id: 2, tag_id: 2 },
      { asset_id: 6, tag_id: 2 },
      { asset_id: 1, tag_id: 3 },
    ];
  }
  if (query.includes("FROM asset_categories")) {
    return [
      { asset_id: 1, category_id: 1 },
      { asset_id: 2, category_id: 1 },
      { asset_id: 3, category_id: 1 },
      { asset_id: 4, category_id: 1 },
      { asset_id: 5, category_id: 1 },
      { asset_id: 6, category_id: 1 },
      { asset_id: 7, category_id: 2 },
      { asset_id: 9, category_id: 5 },
    ];
  }
  if (query.includes("COUNT(*)")) return [{ n: SAMPLE.length }];
  return [];
}

const thumbUrls = new Map<string, string>();

/** Shelf など、キーごとに値を持つストアを再現する。 */
const mockStore = new Map<string, unknown>();

// Shelf は「中身がある状態」も見たいので、代表的な中身を最初から入れておく。
// モックはイベントを配送しないため、後から入れても再描画されない。
mockStore.set(
  "items",
  SAMPLE.slice(0, 3).map((item, i) => ({
    path: `/Users/demo/materials/${item.name}.png`,
    name: item.name,
    kind: "image",
    size: 240_000 + i * 90_000,
    thumbnailPath: `/Users/demo/materials/${item.name}.png`,
    addedAt: "2026-08-08T00:00:00.000Z",
  })),
);

async function mockInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "plugin:sql|load":
      return "sqlite:stash.db";
    case "plugin:sql|select":
      return mockSelect(String(args.query ?? ""));
    case "plugin:sql|execute":
      return [0, 0];
    case "plugin:store|load":
    case "plugin:store|get_store":
      return 1;
    case "plugin:store|get": {
      const value = mockStore.get(String(args.key ?? ""));
      return value === undefined ? [null, false] : [value, true];
    }
    case "plugin:store|set":
      mockStore.set(String(args.key ?? ""), args.value);
      return null;
    case "plugin:store|save":
      return null;
    case "plugin:event|listen":
      return Math.floor(Math.random() * 1e6);
    case "plugin:event|unlisten":
    case "plugin:event|emit":
    case "plugin:event|emit_to":
      return null;
    case "load_full_image": {
      const path = String(args.path ?? "");
      const item = SAMPLE.find((s) => path.includes(s.name)) ?? SAMPLE[0];
      return pngBytes(item.w, item.h, item.hue, item.name);
    }
    case "paths_exist":
      return SAMPLE.map(() => true);
    case "generate_thumbnails": {
      const paths = (args.paths as string[]) ?? [];
      return paths.map((path) => ({ path, thumbnail: path, error: null }));
    }
    case "probe_files": {
      const paths = (args.paths as string[]) ?? [];
      return paths.map((path) => {
        const name = path.split("/").pop() ?? path;
        const dot = name.lastIndexOf(".");
        return {
          path,
          name: dot > 0 ? name.slice(0, dot) : name,
          ext: dot > 0 ? name.slice(dot + 1) : "",
          size: 240_000,
          kind: /\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? "image" : "file",
          width: null,
          height: null,
          hash: null,
        };
      });
    }
    default:
      return null;
  }
}

interface TauriInternals {
  metadata: unknown;
  plugins: Record<string, unknown>;
  transformCallback: (cb: (payload: unknown) => void) => number;
  convertFileSrc: (path: string) => string;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

const globalAny = window as unknown as Record<string, unknown> & {
  __TAURI_INTERNALS__?: TauriInternals;
};

globalAny.__TAURI_OS_PLUGIN_INTERNALS__ = {
  eol: "\n",
  os_type: "macos",
  platform: "macos",
  family: "unix",
  version: "15.0",
  arch: "aarch64",
  exe_extension: "",
};

// listen() の解除経路もここを見に来るので、空実装を置いておく
globalAny.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};

globalAny.__TAURI_INTERNALS__ = {
  metadata: {
    currentWindow: { label: "overlay" },
    currentWebview: { windowLabel: "overlay", label: "overlay" },
  },
  plugins: {},
  transformCallback(cb) {
    const id = Math.floor(Math.random() * 1e9);
    globalAny[`_${id}`] = cb;
    return id;
  },
  convertFileSrc(path: string) {
    if (!path.startsWith("mock://")) return path;
    const id = Number(path.slice("mock://".length));
    const item = SAMPLE.find((s) => s.id === id);
    if (!item) return path;
    let url = thumbUrls.get(path);
    if (!url) {
      url = fakeImage(item.w, item.h, item.hue, item.name).toDataURL("image/png");
      thumbUrls.set(path, url);
    }
    return url;
  },
  invoke: mockInvoke,
};

// ─────────────── モック設置後に本物のコンポーネントを読み込む ───────────────

// 静的 import は巻き上げられてモックより先に走ってしまうので、動的に読み込む
const { OverlayApp } = await import("./windows/overlay/OverlayApp");
const { ManagerApp } = await import("./windows/manager/ManagerApp");
const { ShelfApp } = await import("./windows/shelf/ShelfApp");

function Preview() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 32,
        padding: 32,
        alignItems: "center",
        minHeight: "100%",
        overflow: "auto",
        background:
          "linear-gradient(135deg,#2b3a4d 0%,#101722 45%,#3a2b3f 100%)",
      }}
    >
      <div
        id="overlay-frame"
        style={{ width: 760, height: 520, flexShrink: 0, boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}
      >
        <OverlayApp />
      </div>
      <div
        id="shelf-frame"
        style={{ width: 300, height: 404, flexShrink: 0, boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}
      >
        <ShelfApp />
      </div>

      <div
        id="manager-frame"
        style={{
          width: 1180,
          height: 780,
          flexShrink: 0,
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--surface)",
          boxShadow: "0 30px 80px rgba(0,0,0,.5)",
        }}
      >
        <ManagerApp />
      </div>
    </div>
  );
}

const container = document.getElementById("root")!;
document.documentElement.dataset.material = "vibrancy";
document.body.style.overflow = "auto";
createRoot(container).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
