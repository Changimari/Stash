import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AssetThumb } from "@/components/AssetThumb";
import { Icon } from "@/components/Icon";
import { canCompose, performAction, type ActionFeedback } from "@/lib/actions";
import { IS_MAC, watchWindowMaterial } from "@/lib/appearance";
import { formatBytes, formatDimensions } from "@/lib/format";
import { importPaths } from "@/lib/import";
import { putOnShelf } from "@/lib/shelf";
import { native } from "@/lib/native";
import { copyBindings, formatAccelerator } from "@/lib/settings";
import type { Asset, AssetAction } from "@/lib/types";
import { notifyLibraryChanged, useLibrary, watchLibraryChanges } from "@/store/library";
import { useSettings } from "@/store/settings";
import { CompositePreview } from "./CompositePreview";

/** 窓幅は固定（resizable: false）なので列数も固定でよい。 */
const COLUMNS = 4;

const ACTION_LABELS: Record<AssetAction, string> = {
  copy: "画像だけ",
  copyWithCaption: "画像 + 名前",
  drag: "ドラッグ",
};

export function OverlayApp() {
  const settings = useSettings((s) => s.settings);
  const initSettings = useSettings((s) => s.init);
  const { assets, categories, index, status } = useLibrary();
  const reload = useLibrary((s) => s.reload);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<"entering" | "idle" | "leaving">("entering");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [dropping, setDropping] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── 起動時のセットアップ ──
  useEffect(() => {
    // ホットキーの登録はオーバーレイ窓が担当する。この窓は破棄されないため、
    // 管理画面を閉じても登録が生き続ける。
    void initSettings({ registerHotkey: true });
    const material = watchWindowMaterial();
    const library = watchLibraryChanges();

    // カテゴリの初期投入は管理画面側の担当。両方でやると初回起動時に競合する。
    void reload();

    return () => {
      void material.then((un) => un());
      void library.then((un) => un());
    };
  }, [initSettings, reload]);

  // ── 表示のたびに初期化（§6-1: 表示時に検索バーへ自動フォーカス） ──
  // 設定は毎回 store から読み直す。listen のクロージャに古い値を閉じ込めないため。
  useEffect(() => {
    const shown = listen("overlay:shown", () => {
      const { overlayDefaultScope, overlayLastScope } = useSettings.getState().settings;
      setQuery("");
      setSelected(0);
      setFeedback(null);
      setPhase("entering");
      setScope(
        overlayDefaultScope === "all"
          ? null
          : overlayDefaultScope === "last"
            ? overlayLastScope
            : overlayDefaultScope,
      );
      void reload();
      window.setTimeout(() => inputRef.current?.focus(), 0);
      window.setTimeout(() => setPhase("idle"), 190);
    });
    return () => {
      void shown.then((un) => un());
    };
  }, [reload]);

  // 「前回のカテゴリ」設定のための記憶。切り替えるたびに保存する。
  const updateSettings = useSettings((s) => s.update);
  useEffect(() => {
    if (useSettings.getState().settings.overlayDefaultScope !== "last") return;
    void updateSettings({ overlayLastScope: scope });
  }, [scope, updateSettings]);

  useEffect(() => {
    inputRef.current?.focus();
    const timer = window.setTimeout(() => setPhase("idle"), 190);
    return () => window.clearTimeout(timer);
  }, []);

  // ── 絞り込み ──
  const scoped = useMemo(() => {
    if (scope == null) return assets;
    return assets.filter((a) => a.categoryIds.includes(scope));
  }, [assets, scope]);

  const results = useMemo(() => {
    const searched = index.search(query);
    if (scope == null) return searched;
    const allowed = new Set(scoped.map((a) => a.id));
    return searched.filter((a) => allowed.has(a.id));
  }, [index, query, scope, scoped]);

  const current: Asset | undefined = results[selected];

  useEffect(() => {
    setSelected(0);
  }, [query, scope]);

  // 選択が画面外に出たら追従してスクロールする
  useEffect(() => {
    const node = gridRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [selected, results.length]);

  const dismiss = useCallback(() => {
    setPhase("leaving");
    window.setTimeout(() => void native.hideOverlay(), 85);
  }, []);

  const openLibrary = useCallback(() => {
    void native.showManager();
    dismiss();
  }, [dismiss]);

  // Finder からオーバーレイへ落とされたファイルを、その場でライブラリに取り込む。
  // webview 標準の「落とした画像を開く」挙動は dragDropEnabled と dropGuard で潰してある。
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDropping(true);
        return;
      }
      setDropping(false);
      if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;

      const paths = event.payload.paths;
      setFeedback({ tone: "success", message: `${paths.length} 件を取り込み中…` });
      void importPaths(paths)
        .then(async (summary) => {
          // 管理画面が開いていればそちらにも反映させる
          await notifyLibraryChanged();
          setFeedback({
            tone: summary.added > 0 ? "success" : "warning",
            message:
              summary.added > 0
                ? `${summary.added} 件を追加しました${
                    summary.duplicates > 0 ? `（${summary.duplicates} 件は登録済み）` : ""
                  }`
                : summary.duplicates > 0
                  ? "すべて登録済みでした"
                  : "追加できるものがありませんでした",
          });
        })
        .catch((error: unknown) => {
          setFeedback({
            tone: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, []);

  const run = useCallback(
    async (action: AssetAction) => {
      const asset = results[selected];
      if (!asset) return;

      const outcome = await performAction(action, asset, { settings, isOverlay: true });
      if (action === "drag") return; // ドラッグ中は窓を隠すのでトーストは出さない

      setFeedback(outcome);
      if (outcome.tone === "success") {
        window.setTimeout(dismiss, 520);
      }
    },
    [results, selected, settings, dismiss],
  );

  // ── キーボード操作（§6-3） ──
  const topLevelCategories = useMemo(
    () => categories.filter((c) => c.parentId == null),
    [categories],
  );

  useEffect(() => {
    const bindings = copyBindings(settings);

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = IS_MAC ? event.metaKey : event.ctrlKey;

      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }

      // カテゴリの絞り込みを ⌘1…⌘9 で切り替える
      if (mod && /^[0-9]$/.test(event.key)) {
        event.preventDefault();
        const n = Number(event.key);
        setScope(n === 0 ? null : (topLevelCategories[n - 1]?.id ?? null));
        return;
      }

      if (mod && event.key === ",") {
        event.preventDefault();
        openLibrary();
        return;
      }

      // 選んだ素材を Shelf へ。何件か集めてから一度に運ぶための入口。
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const asset = results[selected];
        if (!asset) return;
        void putOnShelf([asset.filePath]).then(async (n) => {
          await native.showShelf();
          setFeedback({
            tone: n > 0 ? "success" : "warning",
            message: n > 0 ? `「${asset.name}」を Shelf に預けました` : "すでに Shelf にあります",
          });
        });
        return;
      }

      // ⌘C / ⌘⇧C は ⏎ / ⇧⏎ の別名として残しておく
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void run(event.shiftKey ? bindings.withShift : bindings.plain);
        return;
      }

      if (results.length === 0) return;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          setSelected((i) => Math.min(results.length - 1, i + 1));
          break;
        case "ArrowLeft":
          event.preventDefault();
          setSelected((i) => Math.max(0, i - 1));
          break;
        case "ArrowDown":
          event.preventDefault();
          setSelected((i) => Math.min(results.length - 1, i + COLUMNS));
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelected((i) => Math.max(0, i - COLUMNS));
          break;
        case "Home":
          event.preventDefault();
          setSelected(0);
          break;
        case "End":
          event.preventDefault();
          setSelected(results.length - 1);
          break;
        case "Enter":
          event.preventDefault();
          // ⏎ = 画像だけ / ⇧⏎ = 画像 + 名前（設定で入れ替え可）
          void run(event.shiftKey ? bindings.withShift : bindings.plain);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss, results.length, run, settings, topLevelCategories]);

  const bindings = copyBindings(settings);

  return (
    <div
      className="overlay-panel relative select-none"
      data-phase={phase}
      onMouseDown={() => inputRef.current?.focus()}
    >
      {dropping ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 rounded-window bg-accent-soft ring-2 ring-inset ring-accent">
          <Icon name="plus" size={22} className="text-accent" />
          <p className="text-headline font-semibold text-label">ライブラリに追加</p>
          <p className="text-caption text-label-2">ここに落とすと素材として登録します</p>
        </div>
      ) : null}

      <SearchRow
        ref={inputRef}
        value={query}
        onChange={setQuery}
        count={results.length}
        total={assets.length}
      />

      {topLevelCategories.length > 0 ? (
        <ScopeRow
          categories={topLevelCategories}
          active={scope}
          onSelect={setScope}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div
          ref={gridRef}
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
        >
          {status === "loading" ? null : results.length === 0 ? (
            <EmptyState query={query} hasAssets={assets.length > 0} />
          ) : (
            <div className="grid grid-cols-4 gap-2.5">
              {results.map((asset, i) => (
                <ResultTile
                  key={asset.id}
                  asset={asset}
                  index={i}
                  selected={i === selected}
                  showName={settings.showNamesInGrid}
                  onSelect={() => setSelected(i)}
                  onActivate={(withShift) => {
                    setSelected(i);
                    void run(withShift ? bindings.withShift : bindings.plain);
                  }}
                  onDragStart={() => {
                    setSelected(i);
                    void run("drag");
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="w-[248px] shrink-0 border-l border-separator">
          {current ? (
            <DetailPane asset={current} />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-caption text-label-3">
              素材を選ぶと詳細が出ます
            </div>
          )}
        </aside>
      </div>

      <HintBar
        feedback={feedback}
        canCaption={current ? canCompose(current) : false}
        enterLabel={ACTION_LABELS[bindings.plain]}
        shiftLabel={ACTION_LABELS[bindings.withShift]}
        onOpenLibrary={openLibrary}
      />
    </div>
  );
}

// ───────────────────────────── 検索行 ─────────────────────────────

interface SearchRowProps {
  value: string;
  onChange: (value: string) => void;
  count: number;
  total: number;
  ref: React.Ref<HTMLInputElement>;
}

function SearchRow({ value, onChange, count, total, ref }: SearchRowProps) {
  return (
    <div className="flex h-[56px] shrink-0 items-center gap-3 px-4 hairline-b">
      <Icon name="search" size={18} className="shrink-0 text-label-3" strokeWidth={1.5} />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="素材を検索"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        className="min-w-0 flex-1 bg-transparent text-query font-normal tracking-[-0.015em] text-label placeholder:text-label-3 focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="検索語を消す"
          className="shrink-0 text-label-3 transition-colors hover:text-label-2"
        >
          <Icon name="clear" size={15} />
        </button>
      ) : null}
      <span className="shrink-0 text-caption tabular-nums text-label-3">
        {value ? `${count} / ${total}` : `${total}`}
      </span>
    </div>
  );
}

// ───────────────────────────── カテゴリ絞り込み ─────────────────────────────

function ScopeRow({
  categories,
  active,
  onSelect,
}: {
  categories: { id: number; name: string }[];
  active: number | null;
  onSelect: (id: number | null) => void;
}) {
  const items = [{ id: null as number | null, name: "すべて" }, ...categories];

  return (
    <div className="flex h-[34px] shrink-0 items-center gap-1 overflow-x-auto px-3 hairline-b">
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id ?? "all"}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-caption transition-colors ${
              isActive
                ? "bg-accent text-on-accent"
                : "text-label-2 hover:bg-fill-1 hover:text-label"
            }`}
          >
            {item.name}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── 結果タイル ─────────────────────────────

interface TileProps {
  asset: Asset;
  index: number;
  selected: boolean;
  showName: boolean;
  onSelect: () => void;
  onActivate: (withShift: boolean) => void;
  onDragStart: () => void;
}

function ResultTile({
  asset,
  index,
  selected,
  showName,
  onSelect,
  onActivate,
  onDragStart,
}: TileProps) {
  return (
    <div
      data-index={index}
      data-selected={selected}
      className="tile cursor-default p-1.5"
      // ポインタを乗せた素材が詳細ペインに出る。クリックはその場で確定させる。
      onMouseEnter={onSelect}
      onClick={(event) => onActivate(event.shiftKey)}
      draggable
      onDragStart={(event) => {
        // ブラウザ標準の DnD ではなく、OS ネイティブのドラッグに引き渡す
        event.preventDefault();
        onDragStart();
      }}
    >
      <AssetThumb
        asset={asset}
        className="flex h-[68px] w-full items-center justify-center overflow-hidden rounded-sm bg-fill-1"
      />
      {showName ? (
        <p className="mt-1.5 truncate text-center text-footnote leading-tight text-label-2">
          {asset.metadata.caption?.trim() || asset.name}
        </p>
      ) : null}
    </div>
  );
}

// ───────────────────────────── 詳細ペイン ─────────────────────────────

function DetailPane({ asset }: { asset: Asset }) {
  const settings = useSettings((s) => s.settings);
  const caption = asset.metadata.caption?.trim();
  const composable = canCompose(asset);
  const dimensions = formatDimensions(asset.width, asset.height);

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-3.5">
      {/* プレビューは上端寄せ。情報をすぐ下に続けて、間延びさせない。 */}
      <div className="flex max-h-[45%] shrink-0 flex-col items-center justify-start gap-1.5">
        {composable ? (
          <CompositePreview asset={asset} settings={settings} plain={!caption} />
        ) : (
          <AssetThumb
            asset={asset}
            className="flex h-full w-full items-center justify-center rounded-md"
          />
        )}
        {caption && composable ? (
          <span className="shrink-0 text-footnote text-label-3">合成プレビュー</span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
        <p className="truncate text-headline font-semibold text-label">{asset.name}</p>
        {caption ? (
          <p className="truncate text-caption text-label-2" title={caption}>
            {caption}
          </p>
        ) : composable ? (
          <p className="text-caption text-label-3">キャプション未設定</p>
        ) : null}

        <p className="text-footnote tabular-nums text-label-3">
          {[dimensions, asset.metadata.ext?.toUpperCase(), formatBytes(asset.fileSize)]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {asset.tagNames.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {asset.tagNames.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-sm bg-fill-1 px-1.5 py-0.5 text-footnote text-label-2"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────────── 空の状態 ─────────────────────────────

function EmptyState({ query, hasAssets }: { query: string; hasAssets: boolean }) {
  if (!hasAssets) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Icon name="stack" size={26} className="text-label-4" />
        <p className="text-body text-label-2">素材がまだありません</p>
        <p className="text-caption text-label-3">
          {formatAccelerator("CmdOrCtrl+,", IS_MAC)} でライブラリを開いて追加できます
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
      <Icon name="search" size={24} className="text-label-4" />
      <p className="text-body text-label-2">
        {query ? `「${query}」に一致する素材はありません` : "素材がありません"}
      </p>
    </div>
  );
}

// ───────────────────────────── 操作ヒント ─────────────────────────────

function HintBar({
  feedback,
  canCaption,
  enterLabel,
  shiftLabel,
  onOpenLibrary,
}: {
  feedback: ActionFeedback | null;
  canCaption: boolean;
  enterLabel: string;
  shiftLabel: string;
  onOpenLibrary: () => void;
}) {
  if (feedback) {
    const tone =
      feedback.tone === "error"
        ? "text-danger"
        : feedback.tone === "warning"
          ? "text-warning"
          : "text-label-2";
    return (
      <div className="flex h-[30px] shrink-0 items-center gap-1.5 px-4 hairline-t">
        <Icon
          name={feedback.tone === "success" ? "check" : "warning"}
          size={12}
          className={tone}
        />
        <span className={`truncate text-footnote ${tone}`}>{feedback.message}</span>
      </div>
    );
  }

  return (
    <div className="flex h-[30px] shrink-0 items-center gap-4 px-4 hairline-t">
      <Hint combo="↑↓←→" label="選択" />
      {/* クリック / ⇧クリックも同じ動作。キーだけ出して余計な説明は足さない。 */}
      <Hint combo="↩" label={enterLabel} />
      <Hint combo="⇧↩" label={shiftLabel} muted={!canCaption} />
      <div className="flex-1" />
      {/* ここが唯一の「本体へ行く」導線。ショートカットだけだと見つけてもらえない。 */}
      <button
        type="button"
        onClick={onOpenLibrary}
        className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-label-3 transition-colors hover:text-label"
      >
        <Icon name="stack" size={12} />
        <span className="text-footnote">ライブラリ</span>
        <kbd className="keycap">{IS_MAC ? "⌘," : "Ctrl+,"}</kbd>
      </button>
      <Hint combo="esc" label="閉じる" />
    </div>
  );
}

function Hint({ combo, label, muted = false }: { combo: string; label: string; muted?: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 ${muted ? "opacity-40" : ""}`}>
      <kbd className="keycap">{combo}</kbd>
      <span className="text-footnote text-label-3">{label}</span>
    </span>
  );
}
