import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Icon } from "@/components/Icon";
import {
  Button,
  MenuItem,
  MenuSeparator,
  Popover,
  Row,
  Section,
  Segmented,
  Switch,
} from "@/components/ui";
import { IS_MAC } from "@/lib/appearance";
import { BRAND } from "@/lib/brand";
import { composeCaption, FONT_RATIO_MAX, FONT_RATIO_MIN } from "@/lib/compose";
import { blobToObjectUrl, releaseObjectUrl } from "@/lib/image";
import { migrateExistingAssets, resolveLibraryFolder } from "@/lib/library-folder";
import { native } from "@/lib/native";
import { formatAccelerator, type Settings } from "@/lib/settings";
import {
  checkForUpdate,
  installUpdate,
  relaunch,
  type UpdateState,
} from "@/lib/updates";
import { notifyLibraryChanged, useLibrary } from "@/store/library";
import { useSettings } from "@/store/settings";

/** バンドルのバージョン（tauri.conf.json の値）。手書きだと更新し忘れるので実物を読む。 */
function useAppVersion(): string {
  const [version, setVersion] = useState("—");
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("—"));
  }, []);
  return version;
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const applyHotkeys = useSettings((s) => s.applyHotkeys);
  const hotkeyError = useSettings((s) => s.hotkeyError);
  const shelfHotkeyError = useSettings((s) => s.shelfHotkeyError);
  const appVersion = useAppVersion();
  const categories = useLibrary((s) => s.categories);

  // オーバーレイのタブは第一階層だけなので、選択肢もそこに合わせる
  const topLevelCategories = categories.filter((c) => c.parentId == null);
  const scopeLabel =
    settings.overlayDefaultScope === "all"
      ? "すべて"
      : settings.overlayDefaultScope === "last"
        ? "前回のまま"
        : (topLevelCategories.find((c) => c.id === settings.overlayDefaultScope)?.name ??
          "すべて");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/25 pt-10">
      <div
        className="flex max-h-[calc(100%-80px)] w-[540px] flex-col overflow-hidden rounded-window bg-surface shadow-[0_18px_60px_rgba(0,0,0,0.35)] ring-1 ring-black/10"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-separator px-4">
          <h2 className="text-headline font-semibold">設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-label-3 transition-colors hover:text-label"
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <Section title="一般">
            <Row
              label="ホットキー"
              hint={
                hotkeyError ??
                "どのアプリからでもこのキーでランチャーを呼び出せます"
              }
            >
              <HotkeyRecorder
                value={settings.hotkey}
                onCommit={async (accelerator) => {
                  await applyHotkeys(accelerator, settings.shelfHotkey);
                  const ok = useSettings.getState().hotkeyError == null;
                  if (ok) await update({ hotkey: accelerator });
                  return ok;
                }}
              />
            </Row>

            <Row
              label="Shelf のホットキー"
              hint={shelfHotkeyError ?? "一時置き場を開閉します（未割り当てでも Shift ドラッグで開きます）"}
            >
              <HotkeyRecorder
                value={settings.shelfHotkey}
                onCommit={async (accelerator) => {
                  await applyHotkeys(settings.hotkey, accelerator);
                  const ok = useSettings.getState().shelfHotkeyError == null;
                  if (ok) await update({ shelfHotkey: accelerator });
                  return ok;
                }}
              />
            </Row>

            <Row label="外観">
              <Segmented
                value={settings.theme}
                onChange={(theme) => void update({ theme })}
                options={[
                  { value: "system", label: "システム" },
                  { value: "light", label: "ライト" },
                  { value: "dark", label: "ダーク" },
                ]}
              />
            </Row>

            <Row
              label="呼び出したときのカテゴリ"
              hint="ホットキーで開いた直後に選ばれているタブ"
            >
              <Popover label={scopeLabel} align="right">
                {(close) => (
                  <>
                    <MenuItem
                      label="すべて"
                      selected={settings.overlayDefaultScope === "all"}
                      onClick={() => {
                        void update({ overlayDefaultScope: "all" });
                        close();
                      }}
                    />
                    <MenuItem
                      label="前回のまま"
                      selected={settings.overlayDefaultScope === "last"}
                      onClick={() => {
                        void update({ overlayDefaultScope: "last" });
                        close();
                      }}
                    />
                    {topLevelCategories.length > 0 ? <MenuSeparator /> : null}
                    {topLevelCategories.map((category) => (
                      <MenuItem
                        key={category.id}
                        label={category.name}
                        selected={settings.overlayDefaultScope === category.id}
                        onClick={() => {
                          void update({ overlayDefaultScope: category.id });
                          close();
                        }}
                      />
                    ))}
                  </>
                )}
              </Popover>
            </Row>

            <Row
              label="ドラッグ中に Shift で Shelf を出す"
              hint="ファイルを掴んだまま Shift を押すと、ライブラリ / Shelf の 2 分割パネルが開きます"
            >
              <Switch
                checked={settings.dropzoneOnShiftDrag}
                onChange={(dropzoneOnShiftDrag) => {
                  void update({ dropzoneOnShiftDrag });
                  void native.setShelfWatch(dropzoneOnShiftDrag);
                }}
              />
            </Row>

            <LaunchAtLoginRow />
          </Section>

          <Section title="素材ファイルの置き場">
            <LibraryFolderRows />
          </Section>

          <Section title="操作">
            <Row
              label="クリック / ⏎ の動作"
              hint={
                settings.defaultAction === "copyWithCaption"
                  ? "⇧クリック・⇧⏎ は「画像だけ」になります"
                  : "⇧クリック・⇧⏎ は「画像 + 名前」になります"
              }
            >
              <Segmented
                value={settings.defaultAction}
                onChange={(defaultAction) => void update({ defaultAction })}
                options={[
                  { value: "copy", label: "画像だけ" },
                  { value: "copyWithCaption", label: "画像 + 名前" },
                  { value: "drag", label: "ドラッグ" },
                ]}
              />
            </Row>

            <Row
              label="ドラッグ開始で Stash を引っ込める"
              hint="オーバーレイと管理画面を隠し、直前のアプリを前面に戻します"
            >
              <Switch
                checked={settings.hideOnDragStart}
                onChange={(hideOnDragStart) => void update({ hideOnDragStart })}
              />
            </Row>

            <Row
              label="コピーできないときはパスをコピー"
              hint="OS がファイルのコピーに対応していない場合の代替動作"
            >
              <Switch
                checked={settings.pathFallbackOnCopy}
                onChange={(pathFallbackOnCopy) => void update({ pathFallbackOnCopy })}
              />
            </Row>
          </Section>

          <Section title="キャプション合成">
            <Row
              label="名前の背景"
              hint={
                settings.captionTheme === "transparent"
                  ? "背景は透過。黒文字だけが画像の下に乗ります"
                  : "背景を塗りつぶします。貼り先の色が読めないとき用"
              }
            >
              <Segmented
                value={settings.captionTheme}
                onChange={(captionTheme) => void update({ captionTheme })}
                options={[
                  { value: "transparent", label: "透過" },
                  { value: "light", label: "白" },
                  { value: "dark", label: "濃灰" },
                ]}
              />
            </Row>
            <Row label="名前の位置">
              <Segmented
                value={settings.captionPlacement}
                onChange={(captionPlacement) => void update({ captionPlacement })}
                options={[
                  { value: "bottom", label: "下" },
                  { value: "top", label: "上" },
                ]}
              />
            </Row>
            <Row
              label="文字が画像より長いとき"
              hint={
                settings.captionFit === "extend"
                  ? "文字サイズを優先し、画像枠を超えて横に広げます（画像は中央）"
                  : "画像の幅に合わせて 2 行まで折り返します"
              }
            >
              <Segmented
                value={settings.captionFit}
                onChange={(captionFit) => void update({ captionFit })}
                options={[
                  { value: "fit", label: "折り返す" },
                  { value: "extend", label: "はみ出す" },
                ]}
              />
            </Row>
            {/* 絶対 px ではなく「画像に対する比率」で持つ。素材の解像度が違っても
                見た目の比率が揃うので、px を意識せずに決められる。 */}
            <Row
              label="文字の大きさ"
              hint={`画像の${settings.captionFit === "extend" ? "幅" : "短い辺"}に対して ${(
                settings.captionFontRatio * 100
              ).toFixed(1)}%`}
            >
              <input
                type="range"
                min={FONT_RATIO_MIN}
                max={FONT_RATIO_MAX}
                step={0.002}
                value={settings.captionFontRatio}
                onChange={(e) => void update({ captionFontRatio: Number(e.target.value) })}
                className="w-[130px] accent-[var(--accent)]"
              />
            </Row>
            <div className="py-3">
              <CaptionPreview />
            </div>
          </Section>

          <Section title="表示">
            <Row label="グリッドの列数" hint={`${settings.gridColumns} 列`}>
              <input
                type="range"
                min={3}
                max={9}
                step={1}
                value={settings.gridColumns}
                onChange={(e) => void update({ gridColumns: Number(e.target.value) })}
                className="w-[130px] accent-[var(--accent)]"
              />
            </Row>
            <Row label="グリッドに名前を表示">
              <Switch
                checked={settings.showNamesInGrid}
                onChange={(showNamesInGrid) => void update({ showNamesInGrid })}
              />
            </Row>
          </Section>

          <Section title={BRAND.name}>
            <UpdateRow />
            <Row label="バージョン" hint={`${BRAND.name} — ${BRAND.tagline}`}>
              <span className="text-caption tabular-nums text-label-3">{appVersion}</span>
            </Row>
            <Row label="常駐を終了" hint="ホットキーも無効になります">
              <Button variant="danger" onClick={() => void native.quitApp()}>
                終了
              </Button>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── ログイン時に起動 ─────────────────────────

/**
 * 状態の正は OS 側（LaunchAgent / レジストリ）。設定ファイルには持たない。
 * ユーザーがシステム設定から解除しても表示がずれないようにするため。
 */
function LaunchAtLoginRow() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isEnabled()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, []);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    try {
      await (next ? enable() : disable());
      setError(null);
    } catch (e) {
      setEnabled(!next); // 失敗したら表示を戻す
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Row
      label="ログイン時に起動"
      hint={error ?? "起動時は管理画面を出さず、メニューバーに常駐します"}
    >
      <Switch
        checked={enabled ?? false}
        disabled={enabled === null}
        onChange={(next) => void toggle(next)}
      />
    </Row>
  );
}

// ───────────────────────── 素材ファイルの置き場 ─────────────────────────

const IMPORT_MODE_HINTS: Record<Settings["importMode"], string> = {
  move: "取り込んだファイルはこのフォルダへ移動します。取り込み元を片付けても壊れません",
  copy: "複製をこのフォルダに置き、元のファイルもそのまま残します",
  keep: "元の場所を参照するだけです。元を消すとリンク切れになります",
};

function LibraryFolderRows() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const assets = useLibrary((s) => s.assets);
  const [folder, setFolder] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void resolveLibraryFolder(settings).then(setFolder);
  }, [settings]);

  const outsideCount = folder
    ? assets.filter((a) => !a.filePath.startsWith(folder)).length
    : 0;

  const chooseFolder = async () => {
    const picked = await open({ multiple: false, directory: true });
    if (!picked || Array.isArray(picked)) return;
    await update({ libraryFolder: picked });
  };

  const migrate = async () => {
    setBusy(true);
    setStatus("整理中…");
    try {
      const result = await migrateExistingAssets(assets, settings, (done, total) =>
        setStatus(`${done} / ${total}`),
      );
      await notifyLibraryChanged();
      setStatus(
        result.failed > 0
          ? `${result.moved} 件を整理しました（${result.failed} 件は失敗）`
          : `${result.moved} 件を整理しました`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row label="取り込んだファイル" hint={IMPORT_MODE_HINTS[settings.importMode]}>
        <Segmented
          value={settings.importMode}
          onChange={(importMode) => void update({ importMode })}
          options={[
            { value: "move", label: "移動" },
            { value: "copy", label: "コピー" },
            { value: "keep", label: "そのまま" },
          ]}
        />
      </Row>

      <Row label="保管フォルダ" hint={folder || "…"}>
        <div className="flex gap-1.5">
          <Button
            icon="reveal"
            onClick={() => void revealItemInDir(folder).catch(() => {})}
            disabled={!folder}
          >
            開く
          </Button>
          <Button onClick={() => void chooseFolder()}>変更…</Button>
        </div>
      </Row>

      {settings.importMode !== "keep" && outsideCount > 0 ? (
        <Row
          label="フォルダの外にある素材"
          hint={status ?? `${outsideCount} 件がまだ元の場所を参照しています`}
        >
          <Button variant="accent" disabled={busy} onClick={() => void migrate()}>
            まとめて整理
          </Button>
        </Row>
      ) : null}
    </>
  );
}

// ───────────────────────── アップデート ─────────────────────────

function UpdateRow() {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

  const run = async () => {
    setState({ kind: "checking" });
    const result = await checkForUpdate();
    setState(result);
  };

  const install = async () => {
    if (state.kind !== "available") return;
    const { update } = state;
    setState({ kind: "downloading", progress: 0 });
    try {
      await installUpdate(update, (progress) => setState({ kind: "downloading", progress }));
      setState({ kind: "ready" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const hint = (() => {
    switch (state.kind) {
      case "checking":
        return "確認中…";
      case "none":
        return "最新版を使っています";
      case "available":
        return `バージョン ${state.update.version} が利用できます`;
      case "downloading":
        return `ダウンロード中… ${Math.round(state.progress * 100)}%`;
      case "ready":
        return "再起動すると新しいバージョンになります";
      case "error":
        return `確認できませんでした（${state.message}）`;
      default:
        return "配布用のエンドポイントを設定すると使えます";
    }
  })();

  return (
    <Row label="アップデート" hint={hint}>
      {state.kind === "available" ? (
        <Button variant="accent" onClick={() => void install()}>
          インストール
        </Button>
      ) : state.kind === "ready" ? (
        <Button variant="accent" onClick={() => void relaunch()}>
          再起動
        </Button>
      ) : (
        <Button
          disabled={state.kind === "checking" || state.kind === "downloading"}
          onClick={() => void run()}
        >
          確認
        </Button>
      )}
    </Row>
  );
}

// ───────────────────────── ホットキー入力 ─────────────────────────

/** KeyboardEvent.code から、global-shortcut が解釈できるキー名へ。 */
function keyNameFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  return named[code] ?? null;
}

function HotkeyRecorder({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (accelerator: string) => Promise<boolean>;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = async (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(false);
        return;
      }

      const key = keyNameFromCode(event.code);
      if (!key) return; // 修飾キー単体では確定させない

      const parts: string[] = [];
      if (IS_MAC ? event.metaKey : event.ctrlKey) parts.push("CmdOrCtrl");
      if (event.shiftKey) parts.push("Shift");
      if (event.altKey) parts.push("Alt");
      if (IS_MAC && event.ctrlKey) parts.push("Control");

      // 修飾キー無しのホットキーは通常の入力を奪ってしまうので受け付けない
      if (parts.length === 0) return;

      parts.push(key);
      setRecording(false);
      await onCommit(parts.join("+"));
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onCommit]);

  return (
    <button
      type="button"
      onClick={() => setRecording((r) => !r)}
      className={`h-[26px] min-w-[104px] rounded-md border px-2.5 text-body transition-colors ${
        recording
          ? "border-accent bg-accent-soft text-label"
          : "border-separator bg-surface-raised text-label hover:bg-fill-1"
      }`}
    >
      {recording ? "キーを押す…" : formatAccelerator(value, IS_MAC)}
    </button>
  );
}

// ───────────────────────── 合成プレビュー ─────────────────────────

/** 設定画面用のサンプル画像。素材を選ばなくても合成結果を確かめられるようにする。 */
function sampleImage(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 400;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const sky = ctx.createLinearGradient(0, 0, 0, 400);
  sky.addColorStop(0, "#5C7FA8");
  sky.addColorStop(1, "#9FB4C9");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 640, 400);

  ctx.fillStyle = "#E9EEF5";
  ctx.beginPath();
  ctx.arc(150, 120, 44, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3D4C60";
  ctx.beginPath();
  ctx.moveTo(0, 400);
  ctx.lineTo(220, 190);
  ctx.lineTo(390, 330);
  ctx.lineTo(500, 240);
  ctx.lineTo(640, 400);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

function CaptionPreview() {
  const settings = useSettings((s) => s.settings);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let created: string | null = null;

    void (async () => {
      const { blob } = await composeCaption(sampleImage(), {
        lines: ["EXAMPLE-1200XU"],
        placement: settings.captionPlacement,
        theme: settings.captionTheme,
        fontRatio: settings.captionFontRatio,
        fit: settings.captionFit,
      });
      if (!alive) return;
      created = blobToObjectUrl(blob);
      setUrl(created);
    })();

    return () => {
      alive = false;
      releaseObjectUrl(created);
    };
  }, [
    settings.captionPlacement,
    settings.captionTheme,
    settings.captionFontRatio,
    settings.captionFit,
  ]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {url ? (
        // 透過を選んだときに「本当に抜けている」ことが分かるよう市松の上に置く
        <img
          src={url}
          alt="合成結果のプレビュー"
          className="checkerboard max-h-[160px] rounded-md shadow-[0_1px_6px_rgba(0,0,0,0.18)]"
        />
      ) : (
        <div className="h-[160px] w-[240px] animate-pulse rounded-md bg-fill-1" />
      )}
      <span className="text-footnote text-label-3">
        合成結果のプレビュー（市松模様は透過部分）
      </span>
    </div>
  );
}
