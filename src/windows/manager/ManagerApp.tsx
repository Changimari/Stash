import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AssetThumb } from "@/components/AssetThumb";
import { Icon } from "@/components/Icon";
import {
  Button,
  ContextMenu,
  IconButton,
  MenuItem,
  MenuSeparator,
  Popover,
} from "@/components/ui";
import { canCompose, performAction } from "@/lib/actions";
import { watchWindowMaterial } from "@/lib/appearance";
import { CategoryDialog, ConfirmDialog } from "@/components/Dialog";
import {
  createCategory,
  deleteAssets,
  deleteCategory,
  pruneOrphanTags,
  renameCategory,
  updateAsset,
} from "@/lib/db";
import { can } from "@/lib/gating";
import { importFolder, importPaths, type ImportProgress, type ImportSummary } from "@/lib/import";
import { native } from "@/lib/native";
import { relinkFromFolder, relinkSingle } from "@/lib/relink";
import { sortAssets } from "@/lib/search";
import { LIBRARY_SORTS } from "@/lib/settings";
import type { Asset, Category } from "@/lib/types";
import {
  notifyLibraryChanged,
  seedCategoriesIfEmpty,
  useLibrary,
  watchLibraryChanges,
} from "@/store/library";
import { useSettings } from "@/store/settings";
import { Inspector } from "./Inspector";
import { Sidebar, type Scope } from "./Sidebar";
import { SettingsSheet } from "./SettingsSheet";

/** 開いているカテゴリ用ダイアログ。null なら何も出ていない。 */
type CategoryDialogState =
  | { kind: "create"; parentId: number | null }
  | { kind: "rename"; category: Category }
  | { kind: "delete"; category: Category }
  | null;

/** 素材を右クリックしたときのメニュー。 */
type AssetMenuTarget = { ids: number[]; asset: Asset; x: number; y: number } | null;

export function ManagerApp() {
  const settings = useSettings((s) => s.settings);
  const initSettings = useSettings((s) => s.init);
  const updateSettings = useSettings((s) => s.update);
  const { assets, categories, tags, index, status } = useLibrary();
  const reload = useLibrary((s) => s.reload);

  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<number[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<number>>(new Set());
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState>(null);
  const [assetMenu, setAssetMenu] = useState<AssetMenuTarget>(null);
  const [pendingDelete, setPendingDelete] = useState<number[]>([]);
  const toastTimer = useRef<number | null>(null);

  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // ── 起動 ──
  useEffect(() => {
    void initSettings();
    const material = watchWindowMaterial();
    const library = watchLibraryChanges();

    void (async () => {
      await reload();
      const created = await seedCategoriesIfEmpty(useLibrary.getState().categories);
      if (created) await reload();
      await backfillThumbnails();
      await checkMissingFiles();
    })();

    return () => {
      void material.then((un) => un());
      void library.then((un) => un());
    };
  }, [initSettings, reload]);

  /** サムネが無い画像素材を後から焼く（取り込み時に失敗したもの・旧データ用）。 */
  const backfillThumbnails = useCallback(async () => {
    const pending = useLibrary
      .getState()
      .assets.filter((a) => a.type === "image" && !a.thumbnailPath);
    if (pending.length === 0) return;

    const results = await native.generateThumbnails(pending.map((a) => a.filePath));
    const byPath = new Map(pending.map((a) => [a.filePath, a.id]));

    let updated = 0;
    for (const result of results) {
      const id = byPath.get(result.path);
      if (id && result.thumbnail) {
        await updateAsset(id, { thumbnailPath: result.thumbnail });
        updated += 1;
      }
    }
    if (updated > 0) await notifyLibraryChanged();
  }, []);

  /** 元ファイルが消えている素材に印を付ける（§11 リンク切れ）。 */
  const checkMissingFiles = useCallback(async () => {
    const all = useLibrary.getState().assets;
    if (all.length === 0) return;
    const exists = await native.pathsExist(all.map((a) => a.filePath));
    const gone = new Set<number>();
    all.forEach((asset, i) => {
      if (!exists[i]) gone.add(asset.id);
    });
    setMissing(gone);
  }, []);

  // ── 取り込み ──
  const runImport = useCallback(
    async (task: () => Promise<ImportSummary>) => {
      try {
        const summary = await task();
        await notifyLibraryChanged();
        await checkMissingFiles();

        const parts = [`${summary.added} 件を追加`];
        if (summary.duplicates > 0) parts.push(`重複 ${summary.duplicates} 件はスキップ`);
        if (summary.thumbnailFailures > 0)
          parts.push(`サムネイル生成に失敗 ${summary.thumbnailFailures} 件`);
        if (summary.skippedByLimit > 0) parts.push(`上限超過 ${summary.skippedByLimit} 件`);
        flash(parts.join(" · "));
      } catch (error) {
        flash(error instanceof Error ? error.message : String(error));
      } finally {
        setProgress(null);
      }
    },
    [checkMissingFiles, flash],
  );

  const importFiles = useCallback(
    (paths: string[], categoryId?: number | null) =>
      runImport(() => importPaths(paths, { onProgress: setProgress, categoryId })),
    [runImport],
  );

  // Finder / エクスプローラからのドラッグイン取り込み（§7）
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDropping(true);
      } else if (event.payload.type === "drop") {
        setDropping(false);
        void importFiles(
          event.payload.paths,
          scope.kind === "category" ? scope.id : null,
        );
      } else {
        setDropping(false);
      }
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, [importFiles, scope]);

  const chooseFiles = async () => {
    const picked = await open({ multiple: true, directory: false });
    if (!picked) return;
    await importFiles(Array.isArray(picked) ? picked : [picked]);
  };

  const chooseFolder = async () => {
    if (!can("bulkImport")) {
      flash("フォルダ一括取り込みは対象外のプランです");
      return;
    }
    const picked = await open({ multiple: false, directory: true });
    if (!picked || Array.isArray(picked)) return;
    await runImport(() =>
      importFolder(picked, {
        onProgress: setProgress,
        categoryId: scope.kind === "category" ? scope.id : null,
      }),
    );
  };

  // ── 絞り込み ──
  const scoped = useMemo(() => {
    switch (scope.kind) {
      case "recent":
        return assets.filter((a) => a.lastUsedAt).slice(0, 100);
      case "untagged":
        return assets.filter((a) => a.tagIds.length === 0 && a.categoryIds.length === 0);
      case "category":
        return assets.filter((a) => a.categoryIds.includes(scope.id));
      case "tag":
        return assets.filter((a) => a.tagIds.includes(scope.id));
      default:
        return assets;
    }
  }, [assets, scope]);

  const visible = useMemo(() => {
    let matched = scoped;
    if (query.trim()) {
      const allowed = new Set(scoped.map((a) => a.id));
      matched = index.search(query).filter((a) => allowed.has(a.id));
    }
    return sortAssets(matched, settings.librarySort, settings.librarySortDesc);
  }, [index, query, scoped, settings.librarySort, settings.librarySortDesc]);

  useEffect(() => {
    setSelection((current) => {
      const allowed = new Set(visible.map((a) => a.id));
      const next = current.filter((id) => allowed.has(id));
      // 中身が変わらないときは同じ参照を返す。毎回新しい配列を返すと
      // 「state 更新 → 再描画」が無駄に回り、依存の組み方次第でループになる。
      return next.length === current.length ? current : next;
    });
  }, [visible]);

  const primary: Asset | null =
    selection.length > 0 ? (assets.find((a) => a.id === selection.at(-1)) ?? null) : null;

  const selectedAssets = useMemo(() => {
    const chosen = new Set(selection);
    return assets.filter((a) => chosen.has(a.id));
  }, [assets, selection]);

  const missingAssets = useMemo(
    () => assets.filter((a) => missing.has(a.id)),
    [assets, missing],
  );

  // ── リンク切れの復旧 ──
  const relinkOne = useCallback(
    async (asset: Asset) => {
      const picked = await open({ multiple: false, directory: false });
      if (!picked || Array.isArray(picked)) return;
      await relinkSingle(asset, picked);
      await notifyLibraryChanged();
      await checkMissingFiles();
      flash(`「${asset.name}」を貼り直しました`);
    },
    [checkMissingFiles, flash],
  );

  const relinkAll = useCallback(async () => {
    const folder = await open({ multiple: false, directory: true });
    if (!folder || Array.isArray(folder)) return;
    try {
      const result = await relinkFromFolder(missingAssets, folder, (phase) =>
        setProgress({ phase: "scanning", done: 0, total: 0, label: phase }),
      );
      await notifyLibraryChanged();
      await checkMissingFiles();
      flash(
        result.stillMissing > 0
          ? `${result.relinked} 件を貼り直しました（${result.stillMissing} 件は見つからず）`
          : `${result.relinked} 件を貼り直しました`,
      );
    } finally {
      setProgress(null);
    }
  }, [missingAssets, checkMissingFiles, flash]);

  const counts = useMemo(
    () => ({
      all: assets.length,
      recent: assets.filter((a) => a.lastUsedAt).length,
      untagged: assets.filter((a) => a.tagIds.length === 0 && a.categoryIds.length === 0).length,
    }),
    [assets],
  );

  const categoryCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const asset of assets) {
      for (const id of asset.categoryIds) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [assets]);

  const tagCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const asset of assets) {
      for (const id of asset.tagIds) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [assets]);

  // ── 選択と削除 ──
  const selectAt = (asset: Asset, event: React.MouseEvent) => {
    const additive = event.metaKey || event.ctrlKey;
    const ranged = event.shiftKey;

    setSelection((current) => {
      if (additive) {
        return current.includes(asset.id)
          ? current.filter((id) => id !== asset.id)
          : [...current, asset.id];
      }
      if (ranged && current.length > 0) {
        const ids = visible.map((a) => a.id);
        const from = ids.indexOf(current.at(-1)!);
        const to = ids.indexOf(asset.id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          return ids.slice(start, end + 1);
        }
      }
      return [asset.id];
    });
  };

  /** 削除は取り消せないので必ず確認をはさむ。 */
  const askRemove = useCallback((ids: number[]) => {
    if (ids.length > 0) setPendingDelete(ids);
  }, []);

  const confirmRemove = useCallback(async () => {
    if (pendingDelete.length === 0) return;
    // 元ファイルには触れない。Stash の登録だけを消す。
    await deleteAssets(pendingDelete);
    await pruneOrphanTags();
    setSelection((current) => current.filter((id) => !pendingDelete.includes(id)));
    setPendingDelete([]);
    await notifyLibraryChanged();
    flash(`${pendingDelete.length} 件をライブラリから削除しました（元ファイルは残ります）`);
  }, [pendingDelete, flash]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        askRemove(selection);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "a") {
        event.preventDefault();
        setSelection(visible.map((a) => a.id));
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [askRemove, selection, visible]);

  // ── カテゴリの追加 / 名前変更 / 削除 ──
  // window.prompt は Tauri の webview では動かないので、必ずアプリ内ダイアログを使う。
  const closeCategoryDialog = useCallback(() => setCategoryDialog(null), []);

  const runCategoryAction = useCallback(
    async (name: string, parentId: number | null) => {
      if (!categoryDialog) return;
      if (categoryDialog.kind === "create") {
        await createCategory(name, { parentId });
      } else {
        await renameCategory(categoryDialog.category.id, name);
      }
      closeCategoryDialog();
      await notifyLibraryChanged();
    },
    [categoryDialog, closeCategoryDialog],
  );

  const confirmDeleteCategory = useCallback(async () => {
    if (categoryDialog?.kind !== "delete") return;
    const { category } = categoryDialog;
    await deleteCategory(category.id);
    closeCategoryDialog();
    // 表示中のカテゴリを消したら全件表示に戻す（消えた場所に留まらせない）
    setScope((current) =>
      current.kind === "category" && current.id === category.id ? { kind: "all" } : current,
    );
    await notifyLibraryChanged();
    flash(`カテゴリ「${category.name}」を削除しました（素材は残ります）`);
  }, [categoryDialog, closeCategoryDialog, flash]);

  return (
    <div className="manager-shell relative">
      <Sidebar
        scope={scope}
        onScope={setScope}
        categories={categories}
        tags={tags}
        counts={counts}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
        onOpenSettings={() => setSettingsOpen(true)}
        onAddCategory={(parentId) => setCategoryDialog({ kind: "create", parentId })}
        onRenameCategory={(category) => setCategoryDialog({ kind: "rename", category })}
        onDeleteCategory={(category) => setCategoryDialog({ kind: "delete", category })}
      />

      <main className="manager-content">
        <header
          data-tauri-drag-region
          className="flex h-[52px] shrink-0 items-center gap-2 border-b border-separator px-4"
        >
          <div className="relative w-[240px]">
            <Icon
              name="search"
              size={13}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-label-3"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ライブラリを検索"
              spellCheck={false}
              className="h-[26px] w-full rounded-md border border-separator bg-surface-raised pr-2 pl-7 text-body placeholder:text-label-3 focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex-1" />

          {selection.length > 0 ? (
            <>
              <span className="shrink-0 text-caption whitespace-nowrap text-label-3">
                {selection.length} 件選択
              </span>
              <IconButton label="削除" icon="trash" onClick={() => askRemove(selection)} />
            </>
          ) : null}

          <Popover
            icon="list"
            label={LIBRARY_SORTS.find((s) => s.value === settings.librarySort)?.label ?? "並び順"}
          >
            {(close) => (
              <>
                {LIBRARY_SORTS.map((sort) => (
                  <MenuItem
                    key={sort.value}
                    label={sort.label}
                    selected={settings.librarySort === sort.value}
                    onClick={() => {
                      void updateSettings({ librarySort: sort.value });
                      close();
                    }}
                  />
                ))}
                <MenuSeparator />
                <MenuItem
                  label={settings.librarySort === "name" ? "昇順（A→Z）" : "小さい / 古い順"}
                  selected={!settings.librarySortDesc}
                  onClick={() => {
                    void updateSettings({ librarySortDesc: false });
                    close();
                  }}
                />
                <MenuItem
                  label={settings.librarySort === "name" ? "降順（Z→A）" : "大きい / 新しい順"}
                  selected={settings.librarySortDesc}
                  onClick={() => {
                    void updateSettings({ librarySortDesc: true });
                    close();
                  }}
                />
              </>
            )}
          </Popover>

          {/* 取り込みの入口は 1 つにまとめる。横に並べるとツールバーが破綻する。 */}
          <Popover icon="plus" label="追加">
            {(close) => (
              <>
                <MenuItem
                  label="ファイルを選ぶ…"
                  showCheck={false}
                  onClick={() => {
                    close();
                    void chooseFiles();
                  }}
                />
                <MenuItem
                  label="フォルダを取り込む…"
                  showCheck={false}
                  onClick={() => {
                    close();
                    void chooseFolder();
                  }}
                />
              </>
            )}
          </Popover>
        </header>

        {missingAssets.length > 0 ? (
          <div className="flex items-center gap-2 border-b border-separator bg-fill-1 px-4 py-2">
            <Icon name="unlink" size={13} className="shrink-0 text-warning" />
            <span className="min-w-0 flex-1 truncate text-caption text-label-2">
              {missingAssets.length} 件のファイルが見つかりません
            </span>
            <Button icon="folder" onClick={() => void relinkAll()}>
              フォルダを指定して貼り直す
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {status === "error" ? (
            <Centered icon="warning" title="ライブラリを読み込めませんでした" />
          ) : visible.length === 0 ? (
            <Centered
              icon="stack"
              title={
                assets.length === 0
                  ? "素材がまだありません"
                  : query
                    ? `「${query}」に一致する素材はありません`
                    : "この場所に素材はありません"
              }
              hint={
                assets.length === 0
                  ? "ここにファイルをドラッグするか、「素材を追加」から選んでください"
                  : undefined
              }
            />
          ) : (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${settings.gridColumns}, minmax(0, 1fr))`,
              }}
            >
              {visible.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  data-selected={selection.includes(asset.id)}
                  onClick={(event) => selectAt(asset, event)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    // 選択外を右クリックしたらそれ単体を対象にする（Finder と同じ）
                    const targets = selection.includes(asset.id) ? selection : [asset.id];
                    if (!selection.includes(asset.id)) setSelection([asset.id]);
                    setAssetMenu({ ids: targets, asset, x: event.clientX, y: event.clientY });
                  }}
                  className="tile block p-2 text-left"
                >
                  <div className="relative">
                    {/* 素材のアスペクト比がばらついても一覧が揃って見えるよう、
                        タイルは一段沈んだ「窪み」として描く。 */}
                    <AssetThumb
                      asset={asset}
                      className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md bg-surface-sunken p-1.5 ring-1 ring-separator ring-inset"
                    />
                    {missing.has(asset.id) ? (
                      <span
                        title="元ファイルが見つかりません"
                        className="absolute top-1 right-1 rounded-sm bg-surface/85 p-[3px] text-warning"
                      >
                        <Icon name="unlink" size={11} />
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 truncate text-caption text-label">
                    {asset.metadata.caption?.trim() || asset.name}
                  </p>
                  {asset.metadata.caption?.trim() ? (
                    <p className="truncate text-footnote text-label-3">{asset.name}</p>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {progress ? <ProgressBar progress={progress} /> : null}
        {toast ? (
          <div className="border-t border-separator px-4 py-2 text-caption text-label-2">
            {toast}
          </div>
        ) : null}
      </main>

      <Inspector
        asset={primary}
        selectionCount={selection.length}
        selectedAssets={selectedAssets}
        categories={categories}
        settings={settings}
        missing={primary ? missing.has(primary.id) : false}
        onChanged={notifyLibraryChanged}
        onFeedback={flash}
        onRelink={(asset) => void relinkOne(asset)}
      />

      {dropping ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-accent-soft">
          <div className="rounded-lg bg-surface px-4 py-3 text-body shadow-[0_8px_28px_rgba(0,0,0,0.22)]">
            ここにドロップして取り込む
          </div>
        </div>
      ) : null}

      {assetMenu ? (
        <ContextMenu x={assetMenu.x} y={assetMenu.y} onClose={() => setAssetMenu(null)}>
          {(close) => {
            const { asset, ids } = assetMenu;
            const many = ids.length > 1;
            return (
              <>
                <MenuItem
                  label={many ? `${ids.length} 件をコピー` : "コピー"}
                  showCheck={false}
                  onClick={() => {
                    void performAction("copy", asset, { settings, isOverlay: false }).then((r) =>
                      flash(r.message),
                    );
                    close();
                  }}
                />
                {!many && canCompose(asset) ? (
                  <MenuItem
                    label="画像 + 名前でコピー"
                    showCheck={false}
                    onClick={() => {
                      void performAction("copyWithCaption", asset, {
                        settings,
                        isOverlay: false,
                      }).then((r) => flash(r.message));
                      close();
                    }}
                  />
                ) : null}
                <MenuSeparator />
                <MenuItem
                  label="Finder で表示"
                  showCheck={false}
                  onClick={() => {
                    void revealItemInDir(asset.filePath).catch(() => {});
                    close();
                  }}
                />
                <MenuSeparator />
                <MenuItem
                  label={many ? `${ids.length} 件を削除…` : "削除…"}
                  tone="danger"
                  showCheck={false}
                  onClick={() => {
                    askRemove(ids);
                    close();
                  }}
                />
              </>
            );
          }}
        </ContextMenu>
      ) : null}

      {pendingDelete.length > 0 ? (
        <ConfirmDialog
          title={`${pendingDelete.length} 件をライブラリから削除しますか？`}
          message="Stash の登録だけを消します。元のファイルは削除されません。"
          onConfirm={() => void confirmRemove()}
          onCancel={() => setPendingDelete([])}
        />
      ) : null}

      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}

      {categoryDialog?.kind === "create" ? (
        <CategoryDialog
          mode="create"
          categories={categories}
          initialParentId={categoryDialog.parentId}
          onConfirm={(name, parentId) => void runCategoryAction(name, parentId)}
          onCancel={closeCategoryDialog}
        />
      ) : null}

      {categoryDialog?.kind === "rename" ? (
        <CategoryDialog
          mode="rename"
          categories={categories}
          initialName={categoryDialog.category.name}
          onConfirm={(name) => void runCategoryAction(name, null)}
          onCancel={closeCategoryDialog}
        />
      ) : null}

      {categoryDialog?.kind === "delete" ? (
        <ConfirmDialog
          title={`「${categoryDialog.category.name}」を削除しますか？`}
          message="このカテゴリとサブカテゴリの割り当てが外れます。素材そのものと元ファイルは削除されません。"
          onConfirm={() => void confirmDeleteCategory()}
          onCancel={closeCategoryDialog}
        />
      ) : null}
    </div>
  );
}

function ProgressBar({ progress }: { progress: ImportProgress }) {
  const labels: Record<ImportProgress["phase"], string> = {
    scanning: "フォルダを走査中…",
    probing: "ファイルを解析中…",
    thumbnails: "サムネイルを生成中…",
    saving: "保存中…",
    done: "完了",
  };
  return (
    <div className="flex items-center gap-2 border-t border-separator px-4 py-2">
      <span className="text-caption text-label-2">
        {progress.label ?? labels[progress.phase]}
      </span>
      {progress.total > 0 ? (
        <span className="text-caption tabular-nums text-label-3">{progress.total} 件</span>
      ) : null}
      <div className="ml-2 h-[3px] flex-1 overflow-hidden rounded-pill bg-fill-2">
        <div className="h-full w-1/3 animate-pulse rounded-pill bg-accent" />
      </div>
    </div>
  );
}

function Centered({
  icon,
  title,
  hint,
}: {
  icon: "stack" | "warning";
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <Icon name={icon} size={28} className="text-label-4" />
      <p className="text-body text-label-2">{title}</p>
      {hint ? <p className="max-w-[320px] text-caption text-label-3">{hint}</p> : null}
    </div>
  );
}
