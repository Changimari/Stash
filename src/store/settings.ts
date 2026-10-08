import { create } from "zustand";
import { applyTheme } from "@/lib/appearance";
import { native } from "@/lib/native";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsChanged,
  saveSettings,
  type Settings,
} from "@/lib/settings";

interface SettingsState {
  settings: Settings;
  ready: boolean;
  /** ホットキー登録が失敗したときの理由。設定画面がそのまま表示する。 */
  hotkeyError: string | null;
  shelfHotkeyError: string | null;
  init: (options?: { registerHotkey?: boolean }) => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  /** ランチャーと Shelf の 2 つをまとめて登録し直す。片方だけ失敗しても他方は生きる。 */
  applyHotkeys: (launcher: string, shelf: string) => Promise<void>;
}

/** 設定変更イベントの購読は 1 窓につき 1 回だけ（StrictMode の二重実行対策）。 */
let subscribed = false;

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  ready: false,
  hotkeyError: null,
  shelfHotkeyError: null,

  init: async ({ registerHotkey = false } = {}) => {
    const settings = await loadSettings();
    applyTheme(settings.theme);
    set({ settings, ready: true });

    if (registerHotkey) {
      await get().applyHotkeys(settings.hotkey, settings.shelfHotkey);
    }

    // 他の窓での変更に追従する
    if (!subscribed) {
      subscribed = true;
      void onSettingsChanged((next) => {
        applyTheme(next.theme);
        set({ settings: next });
      });
    }
  },

  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    applyTheme(next.theme);
    set({ settings: next });
    await saveSettings(next);
  },

  /** 失敗理由は `hotkeyError` / `shelfHotkeyError` に残す（§11 ホットキー競合）。 */
  applyHotkeys: async (launcher, shelf) => {
    try {
      const result = await native.registerHotkeys(launcher, shelf);
      set({
        hotkeyError: result.launcherError ?? null,
        shelfHotkeyError: result.shelfError ?? null,
      });
    } catch (error) {
      const message = typeof error === "string" ? error : String(error);
      set({ hotkeyError: message, shelfHotkeyError: message });
    }
  },
}));
