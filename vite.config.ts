import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;

// Stash は 2 つの窓（manager / overlay）を持つマルチページ構成。
// 各窓は独立した HTML エントリを持ち、同じ SQLite / 設定ストアを共有する。
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { "@": resolve(import.meta.dirname,"src") },
  },

  build: {
    rollupOptions: {
      input: {
        manager: resolve(import.meta.dirname,"index.html"),
        overlay: resolve(import.meta.dirname,"overlay.html"),
        shelf: resolve(import.meta.dirname,"shelf.html"),
      },
    },
    // Tauri は最新の WebView を使うので、モダンターゲットで出力する
    target: "safari15",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  // Tauri CLI が固定ポートを期待するため、勝手なポート変更を禁止する
  clearScreen: false,
  server: {
    port: 1428,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1429 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
