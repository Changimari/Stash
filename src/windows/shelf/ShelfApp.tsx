/**
 * Shelf — ドラッグの一時置き場。
 *
 * ファイルを掴んだまま Shift を押すと、カーソルの下に小さく開く（ドロップ待ち）。
 * 左に落とせばライブラリへ登録、右に落とせば Shelf に残る。
 * 右に落とした後は一覧の姿に伸びてそのまま残るので、あとから掴んで運び出せる。
 *
 * どちら側に落ちたかの判定は Rust 側（カーソル位置 vs 窓の矩形）に一本化している。
 * ドロップイベントの座標は単位が環境依存で当てにならない。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Icon } from "@/components/Icon";
import { dragOutPaths } from "@/lib/drag";
import { formatBytes } from "@/lib/format";
import { thumbUrl } from "@/lib/image";
import { importPaths } from "@/lib/import";
import { native } from "@/lib/native";
import {
  clearShelf,
  putOnShelf,
  readShelf,
  removeFromShelf,
  watchShelf,
  type ShelfItem,
} from "@/lib/shelf";
import { notifyLibraryChanged } from "@/store/library";

type Side = "library" | "shelf" | null;
type Mode = "drop" | "list";

export function ShelfApp() {
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [mode, setMode] = useState<Mode>("list");
  const [side, setSide] = useState<Side>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setItems(await readShelf()), []);

  /**
   * 取り出す。
   *
   * OS へ渡すのは常に複製（move を宣言すると多くのアプリがドロップを拒否する）。
   * 「取り出したら手元から消える」感触は、Shelf の項目を消すことで表す。
   * `⌥` を押しながらなら Shelf に残す。実ファイルはどちらでも元の場所に残る。
   */
  const takeOut = useCallback((targets: string[], keep: boolean, icon: string | null) => {
    void dragOutPaths(targets, {
      retreat: true,
      icon,
      onFinish: (result) => {
        if (!keep && result === "Dropped") void removeFromShelf(targets);
      },
    });
  }, []);

  const flash = useCallback((message: string) => {
    setNote(message);
    window.setTimeout(() => setNote(null), 2400);
  }, []);

  useEffect(() => {
    void refresh();
    const unwatch = watchShelf(() => void refresh());
    const onMode = listen<Mode>("shelf:mode", (e) => setMode(e.payload));
    const onSide = listen<Side>("shelf:side", (e) => setSide(e.payload));
    return () => {
      unwatch();
      void onMode.then((un) => un());
      void onSide.then((un) => un());
    };
  }, [refresh]);

  // 預かり中かどうかを Rust に伝えておく。
  // これが無いと、無関係な Shift ドラッグを空振りしたときに預かり物ごと畳まれてしまう。
  useEffect(() => {
    void native.shelfKeepOpen(items.length > 0);
  }, [items.length]);

  // 空になったら閉じる。中身が無い置き場を出しっぱなしにしない。
  // 最初から空のとき（メニューバーから開いた直後）は閉じない。
  const hadItems = useRef(false);
  useEffect(() => {
    if (items.length > 0) {
      hadItems.current = true;
      return;
    }
    if (!hadItems.current) return;
    hadItems.current = false;
    void native.hideShelf();
  }, [items.length]);

  /** 閉じるときは中身も捨てる。Shelf は運搬中の物を置く場所で、保管庫ではない。 */
  const closeAndReset = useCallback(async () => {
    hadItems.current = false;
    await clearShelf();
    await native.hideShelf();
  }, []);

  // ── ドロップを受ける ──
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const paths = event.payload.paths;
      if (paths.length === 0) return;

      // 結果を出すまで Rust 側に閉じさせない
      void native.shelfKeepOpen(true);

      void (async () => {
        const dropped: Side = (await native.shelfSide()) ?? side ?? "shelf";
        setSide(null);
        try {
          if (dropped === "library") {
            const summary = await importPaths(paths);
            await notifyLibraryChanged();
            flash(
              summary.added > 0
                ? `${summary.added} 件をライブラリに登録しました`
                : "すべて登録済みでした",
            );
            // 中身があれば一覧で残す。空なら「空になったら閉じる」側が畳む。
            if ((await readShelf()).length > 0) await native.expandShelf();
          } else {
            const n = await putOnShelf(paths);
            flash(n > 0 ? `${n} 件を預かりました` : "すでに Shelf にあります");
            // 預けたものが見えるように一覧の姿へ伸ばして残す
            await native.expandShelf();
          }
        } catch (error) {
          flash(error instanceof Error ? error.message : String(error));
          await native.expandShelf();
        }
      })();
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, [side, flash]);

  const paths = items.map((i) => i.path);

  const addAllToLibrary = useCallback(async () => {
    if (paths.length === 0) return;
    setBusy(true);
    try {
      const summary = await importPaths(paths);
      await notifyLibraryChanged();
      await clearShelf();
      flash(
        summary.added > 0
          ? `${summary.added} 件をライブラリに登録しました`
          : "すべて登録済みでした",
      );
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [paths, flash]);

  // ── ドロップ待ちの姿 ──
  if (mode === "drop") {
    return (
      <div className="shelf-panel flex select-none flex-row">
        <Zone
          active={side === "library"}
          icon="stack"
          title="ライブラリ"
          hint="素材として登録"
        />
        <div className="w-px shrink-0 bg-separator" />
        <Zone
          active={side === "shelf"}
          icon="folder"
          title="Shelf"
          hint={items.length > 0 ? `預かり中 ${items.length} 件` : "あとで取り出す"}
        />
      </div>
    );
  }

  // ── 一覧の姿 ──
  return (
    <div className="shelf-panel select-none">
      {/* ヘッダー全体がつかみ手。好きな場所へ動かして使う。 */}
      <div
        data-tauri-drag-region
        className="flex h-[38px] shrink-0 items-center gap-2 px-3 hairline-b"
      >
        <Icon name="folder" size={14} className="pointer-events-none text-label-3" />
        <span className="pointer-events-none flex-1 text-caption font-semibold text-label">
          Shelf{items.length > 0 ? ` · ${items.length}` : ""}
        </span>
        {items.length > 0 ? (
          <button
            type="button"
            title="すべて取り除く"
            onClick={() => void clearShelf()}
            className="rounded-sm p-1 text-label-3 transition-colors hover:text-danger"
          >
            <Icon name="trash" size={13} />
          </button>
        ) : null}
        <button
          type="button"
          title="閉じる（預かり中のものは破棄されます）"
          onClick={() => void closeAndReset()}
          className="rounded-sm p-1 text-label-3 transition-colors hover:text-label"
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Icon name="folder" size={22} className="text-label-4" />
          <p className="text-caption text-label-2">預かり中のものはありません</p>
          <p className="text-footnote leading-snug text-label-3">
            ファイルを掴んだまま Shift を押すと、ここが開きます。
          </p>
        </div>
      ) : (
        <>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              event.preventDefault();
              takeOut(paths, event.altKey, items[0]?.thumbnailPath ?? null);
            }}
            className="mx-2 mt-2 flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent-soft py-1.5 text-caption text-label transition-colors hover:bg-accent hover:text-on-accent"
          >
            <Icon name="stack" size={12} />
            {items.length} 件をまとめて取り出す
          </button>

          <p className="shrink-0 px-3 pt-1 text-center text-footnote text-label-3">
            取り出すと Shelf から消えます · ⌥ で残す
          </p>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {items.map((item) => (
              <ShelfRow
                key={item.path}
                item={item}
                onDrag={(keep) => takeOut([item.path], keep, item.thumbnailPath)}
                onRemove={() => void removeFromShelf([item.path])}
              />
            ))}
          </div>

          <div className="shrink-0 p-2 hairline-t">
            <button
              type="button"
              disabled={busy}
              onClick={() => void addAllToLibrary()}
              className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-caption text-label-2 transition-colors hover:bg-fill-1 hover:text-label disabled:opacity-40"
            >
              <Icon name="plus" size={12} />
              ライブラリに登録
            </button>
          </div>
        </>
      )}

      {note ? (
        <div className="shrink-0 truncate px-3 py-1.5 text-footnote text-label-2 hairline-t">
          {note}
        </div>
      ) : null}
    </div>
  );
}

function Zone({
  active,
  icon,
  title,
  hint,
}: {
  active: boolean;
  icon: "stack" | "folder";
  title: string;
  hint: string;
}) {
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-100 ${
        active ? "bg-accent text-on-accent" : "text-label-2"
      }`}
    >
      <Icon name={icon} size={17} className={active ? "" : "text-label-3"} />
      <span className={`text-caption font-semibold ${active ? "" : "text-label"}`}>
        {title}
      </span>
      <span className={`text-footnote ${active ? "opacity-80" : "text-label-3"}`}>{hint}</span>
    </div>
  );
}

function ShelfRow({
  item,
  onDrag,
  onRemove,
}: {
  item: ShelfItem;
  /** Option を押しながら掴んだか（true なら Shelf に残す）。 */
  onDrag: (keep: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        // ブラウザ標準の DnD ではなく OS ネイティブのドラッグへ渡す
        event.preventDefault();
        onDrag(event.altKey);
      }}
      className="group flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-fill-1"
    >
      <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-sunken ring-1 ring-separator ring-inset">
        {item.thumbnailPath ? (
          <img
            src={thumbUrl(item.thumbnailPath) ?? ""}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon name="doc" size={14} className="text-label-3" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-caption text-label">{item.name}</p>
        <p className="truncate text-footnote text-label-3">{formatBytes(item.size)}</p>
      </div>

      <button
        type="button"
        title="取り除く"
        onClick={onRemove}
        className="shrink-0 rounded-sm p-1 text-label-4 opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
