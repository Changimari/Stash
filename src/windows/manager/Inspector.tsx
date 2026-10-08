import { useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AssetThumb } from "@/components/AssetThumb";
import { Icon } from "@/components/Icon";
import { Button, IconButton, TextField } from "@/components/ui";
import { canCompose, performAction } from "@/lib/actions";
import {
  addCategoryToAssets,
  addTagsToAssets,
  fillCaptionsFromName,
  removeCategoryFromAssets,
  setAssetCategories,
  setAssetTags,
  updateAsset,
} from "@/lib/db";
import { formatBytes, formatDimensions, formatRelativeTime, shortenPath } from "@/lib/format";
import type { Settings } from "@/lib/settings";
import type { Asset, Category } from "@/lib/types";
import { CompositePreview } from "@/windows/overlay/CompositePreview";

interface Props {
  asset: Asset | null;
  selectionCount: number;
  /** 複数選択時の一括操作に使う。単体選択なら 1 件だけ入る。 */
  selectedAssets: Asset[];
  categories: Category[];
  settings: Settings;
  missing: boolean;
  onChanged: () => Promise<void> | void;
  onFeedback: (message: string) => void;
  onRelink: (asset: Asset) => void;
}

export function Inspector({
  asset,
  selectionCount,
  selectedAssets,
  categories,
  settings,
  missing,
  onChanged,
  onFeedback,
  onRelink,
}: Props) {
  const [name, setName] = useState("");
  const [caption, setCaption] = useState("");
  const [tagText, setTagText] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setName(asset?.name ?? "");
    setCaption(asset?.metadata.caption ?? "");
    setTagText(asset?.tagNames.join(", ") ?? "");
    setDirty(false);
  }, [asset?.id, asset?.updatedAt]);

  const composable = asset ? canCompose(asset) : false;
  const assignedCategories = useMemo(
    () => new Set(asset?.categoryIds ?? []),
    [asset?.categoryIds],
  );

  if (selectionCount > 1) {
    return (
      <BulkPanel
        assets={selectedAssets}
        categories={categories}
        onChanged={onChanged}
        onFeedback={onFeedback}
      />
    );
  }

  if (!asset) {
    return (
      <aside className="flex w-[300px] shrink-0 items-center justify-center border-l border-separator px-6 text-center text-caption text-label-3">
        素材を選ぶと詳細が出ます
      </aside>
    );
  }

  const save = async () => {
    await updateAsset(asset.id, {
      name: name.trim() || asset.name,
      metadata: { ...asset.metadata, caption: caption.trim() || undefined },
    });
    await setAssetTags(
      asset.id,
      tagText
        .split(/[,、]/)
        .map((t) => t.trim())
        .filter(Boolean),
    );
    setDirty(false);
    await onChanged();
  };

  const toggleCategory = async (categoryId: number) => {
    const next = new Set(assignedCategories);
    next.has(categoryId) ? next.delete(categoryId) : next.add(categoryId);
    await setAssetCategories(asset.id, [...next]);
    await onChanged();
  };

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-separator">
      <div className="flex h-[170px] shrink-0 items-center justify-center border-b border-separator p-4">
        {composable ? (
          <CompositePreview asset={asset} settings={settings} plain={!caption.trim()} />
        ) : (
          <AssetThumb
            asset={asset}
            checkered
            className="flex h-full w-full items-center justify-center overflow-hidden rounded-md"
          />
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {missing ? (
          <div className="space-y-2 rounded-md bg-fill-1 px-2.5 py-2">
            <div className="flex items-start gap-2 text-caption text-warning">
              <Icon name="unlink" size={13} className="mt-[2px] shrink-0" />
              <span>元のファイルが見つかりません。移動または削除された可能性があります。</span>
            </div>
            <Button onClick={() => onRelink(asset)}>ファイルを探す…</Button>
          </div>
        ) : null}

        {/* ★ キャプションは合成コピーの要。最上部に置き、視覚的にも強調する（§7）。 */}
        <TextField
          label="キャプション（型番・機器名）"
          emphasized
          value={caption}
          placeholder={asset.name}
          onChange={(e) => {
            setCaption(e.target.value);
            setDirty(true);
          }}
          hint={
            composable
              ? "画像の下にこの文字が入った 1 枚としてコピーできます"
              : "画像素材のときに合成コピーで使われます"
          }
        />

        <TextField
          label="名前"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
        />

        <TextField
          label="タグ"
          value={tagText}
          placeholder="カンマ区切り"
          onChange={(e) => {
            setTagText(e.target.value);
            setDirty(true);
          }}
        />

        <div className="space-y-1">
          <span className="block text-caption text-label-2">カテゴリ</span>
          {categories.length === 0 ? (
            <p className="text-caption text-label-3">カテゴリがまだありません</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {categories.map((category) => {
                const on = assignedCategories.has(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => void toggleCategory(category.id)}
                    className={`rounded-md px-2 py-[3px] text-caption transition-colors ${
                      on
                        ? "bg-accent text-on-accent"
                        : "bg-fill-1 text-label-2 hover:bg-fill-2 hover:text-label"
                    }`}
                  >
                    {category.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <dl className="space-y-1 text-caption text-label-3">
          <Meta label="種別" value={asset.type === "image" ? "画像" : "ファイル"} />
          <Meta
            label="サイズ"
            value={
              [formatDimensions(asset.width, asset.height), formatBytes(asset.fileSize)]
                .filter(Boolean)
                .join(" · ") || "—"
            }
          />
          <Meta label="使用回数" value={`${asset.useCount} 回`} />
          <Meta label="最終使用" value={formatRelativeTime(asset.lastUsedAt) ?? "—"} />
          <Meta label="場所" value={shortenPath(asset.filePath, 2)} title={asset.filePath} />
        </dl>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-separator p-3">
        <Button variant="accent" disabled={!dirty} onClick={() => void save()}>
          保存
        </Button>
        <Button
          icon="copy"
          onClick={async () => {
            const result = await performAction("copy", asset, { settings });
            onFeedback(result.message);
          }}
        >
          コピー
        </Button>
        {composable ? (
          <IconButton
            label="キャプション付きでコピー"
            icon="caption"
            onClick={async () => {
              const result = await performAction("copyWithCaption", asset, { settings });
              onFeedback(result.message);
            }}
          />
        ) : null}
        <div className="flex-1" />
        <IconButton
          label="Finder で表示"
          icon="reveal"
          onClick={() => void revealItemInDir(asset.filePath).catch(() => {})}
        />
      </div>
    </aside>
  );
}

// ───────────────────────── 複数選択時 ─────────────────────────

/**
 * 複数選択したときの一括操作。カテゴリは「全部に付いている / 一部 / 付いていない」の
 * 3 状態を見せ、押すと付与 ↔ 解除を切り替える。
 */
function BulkPanel({
  assets,
  categories,
  onChanged,
  onFeedback,
}: {
  assets: Asset[];
  categories: Category[];
  onChanged: () => Promise<void> | void;
  onFeedback: (message: string) => void;
}) {
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = assets.map((a) => a.id);

  /** そのカテゴリが全件に付いているか、一部か、まったく付いていないか。 */
  const coverage = (categoryId: number): "all" | "some" | "none" => {
    const n = assets.filter((a) => a.categoryIds.includes(categoryId)).length;
    return n === 0 ? "none" : n === assets.length ? "all" : "some";
  };

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    try {
      onFeedback(await task());
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = (category: Category) =>
    run(async () => {
      if (coverage(category.id) === "all") {
        await removeCategoryFromAssets(ids, category.id);
        return `${assets.length} 件から「${category.name}」を外しました`;
      }
      await addCategoryToAssets(ids, category.id);
      return `${assets.length} 件に「${category.name}」を付けました`;
    });

  const applyTags = () =>
    run(async () => {
      const names = tagText
        .split(/[,、]/)
        .map((t) => t.trim())
        .filter(Boolean);
      await addTagsToAssets(ids, names);
      setTagText("");
      return `${assets.length} 件にタグを付けました`;
    });

  const fillCaptions = (overwrite: boolean) =>
    run(async () => {
      const n = await fillCaptionsFromName(assets, overwrite);
      return n === 0
        ? "更新が必要な素材はありませんでした"
        : `${n} 件のキャプションを名前から入れました`;
    });

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-separator">
      <div className="flex h-[64px] shrink-0 items-center gap-2 border-b border-separator px-4">
        <Icon name="stack" size={18} className="text-label-3" />
        <p className="text-headline font-semibold text-label">{assets.length} 件を選択中</p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <span className="block text-caption font-semibold text-label">キャプション</span>
          <p className="text-caption leading-snug text-label-3">
            ファイル名に型番が入っているなら、まとめて流し込めます。
          </p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Button disabled={busy} onClick={() => void fillCaptions(false)}>
              空欄だけ名前で埋める
            </Button>
            <Button disabled={busy} onClick={() => void fillCaptions(true)}>
              全部を名前で上書き
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <span className="block text-caption text-label-2">タグを追加</span>
          <div className="flex gap-1.5">
            <input
              value={tagText}
              placeholder="カンマ区切り"
              spellCheck={false}
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagText.trim()) void applyTags();
              }}
              className="min-w-0 flex-1 rounded-md border border-separator bg-surface-raised px-2 py-1.5 text-body text-label placeholder:text-label-3 focus:border-accent focus:outline-none"
            />
            <Button
              variant="accent"
              disabled={busy || !tagText.trim()}
              onClick={() => void applyTags()}
            >
              追加
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <span className="block text-caption text-label-2">カテゴリ</span>
          {categories.length === 0 ? (
            <p className="text-caption text-label-3">カテゴリがまだありません</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {categories.map((category) => {
                const state = coverage(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void toggleCategory(category)}
                    title={
                      state === "some" ? "一部の素材にだけ付いています" : undefined
                    }
                    className={`rounded-md px-2 py-[3px] text-caption transition-colors disabled:opacity-40 ${
                      state === "all"
                        ? "bg-accent text-on-accent"
                        : state === "some"
                          ? "bg-accent-soft text-label"
                          : "bg-fill-1 text-label-2 hover:bg-fill-2 hover:text-label"
                    }`}
                  >
                    {category.name}
                    {state === "some" ? " ・一部" : ""}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function Meta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-label-3">{label}</dt>
      <dd className="min-w-0 truncate text-right text-label-2" title={title}>
        {value}
      </dd>
    </div>
  );
}
