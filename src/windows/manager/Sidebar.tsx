import { useState, type MouseEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { ContextMenu, MenuItem, MenuSeparator } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import type { Category, Tag } from "@/lib/types";

export type Scope =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "untagged" }
  | { kind: "category"; id: number }
  | { kind: "tag"; id: number };

export function scopeKey(scope: Scope): string {
  return scope.kind === "category" || scope.kind === "tag"
    ? `${scope.kind}:${scope.id}`
    : scope.kind;
}

interface Props {
  scope: Scope;
  onScope: (scope: Scope) => void;
  categories: Category[];
  tags: Tag[];
  counts: { all: number; recent: number; untagged: number };
  categoryCounts: Map<number, number>;
  tagCounts: Map<number, number>;
  onOpenSettings: () => void;
  onAddCategory: (parentId: number | null) => void;
  onRenameCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
}

/** 右クリックされたカテゴリと、メニューを出す位置。 */
export interface CategoryMenuTarget {
  category: Category;
  x: number;
  y: number;
}

export function Sidebar({
  scope,
  onScope,
  categories,
  tags,
  counts,
  categoryCounts,
  tagCounts,
  onOpenSettings,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
}: Props) {
  const [menu, setMenu] = useState<CategoryMenuTarget | null>(null);
  const active = scopeKey(scope);
  const roots = categories.filter((c) => c.parentId == null);
  const childrenOf = (id: number) => categories.filter((c) => c.parentId === id);

  /** ネストは何段でも描く。スキーマ上 parent_id は無制限なので UI 側も合わせる。 */
  const renderCategory = (category: Category, depth: number): ReactNode => (
    <div key={category.id}>
      <Item
        icon="folder"
        label={category.name}
        count={categoryCounts.get(category.id) ?? 0}
        active={active === `category:${category.id}`}
        depth={depth}
        onClick={() => onScope({ kind: "category", id: category.id })}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ category, x: event.clientX, y: event.clientY });
        }}
      />
      {childrenOf(category.id).map((child) => renderCategory(child, depth + 1))}
    </div>
  );

  return (
    <nav className="manager-sidebar traffic-light-inset flex w-[216px] shrink-0 flex-col">
      <div
        data-tauri-drag-region
        className="flex h-[38px] shrink-0 items-center px-4 text-caption font-semibold text-label-2"
      >
        {BRAND.name}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <Item
          icon="stack"
          label="すべての素材"
          count={counts.all}
          active={active === "all"}
          onClick={() => onScope({ kind: "all" })}
        />
        <Item
          icon="clock"
          label="最近使った"
          count={counts.recent}
          active={active === "recent"}
          onClick={() => onScope({ kind: "recent" })}
        />
        <Item
          icon="warning"
          label="未分類"
          count={counts.untagged}
          active={active === "untagged"}
          onClick={() => onScope({ kind: "untagged" })}
        />

        <GroupHeading label="カテゴリ" onAdd={() => onAddCategory(null)} />
        {roots.length === 0 ? (
          <p className="px-2 py-1 text-caption text-label-3">
            右上の + から追加できます
          </p>
        ) : (
          roots.map((category) => renderCategory(category, 0))
        )}

        {tags.length > 0 ? (
          <>
            <GroupHeading label="タグ" />
            {tags.map((tag) => (
              <Item
                key={tag.id}
                icon="tag"
                label={tag.name}
                count={tagCounts.get(tag.id) ?? 0}
                active={active === `tag:${tag.id}`}
                onClick={() => onScope({ kind: "tag", id: tag.id })}
              />
            ))}
          </>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-separator p-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body text-label-2 transition-colors hover:bg-fill-1 hover:text-label"
        >
          <Icon name="gear" size={15} />
          設定
        </button>
      </div>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {(close) => (
            <>
              <MenuItem
                label="名前を変更…"
                showCheck={false}
                onClick={() => {
                  onRenameCategory(menu.category);
                  close();
                }}
              />
              <MenuItem
                label="サブカテゴリを追加…"
                showCheck={false}
                onClick={() => {
                  onAddCategory(menu.category.id);
                  close();
                }}
              />
              <MenuSeparator />
              <MenuItem
                label="削除…"
                tone="danger"
                showCheck={false}
                onClick={() => {
                  onDeleteCategory(menu.category);
                  close();
                }}
              />
            </>
          )}
        </ContextMenu>
      ) : null}
    </nav>
  );
}

function GroupHeading({ label, onAdd }: { label: string; onAdd?: () => void }) {
  return (
    <div className="mt-4 mb-0.5 flex items-center justify-between px-2">
      <span className="text-footnote font-semibold tracking-wide text-label-3">{label}</span>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`${label}を追加`}
          className="text-label-3 transition-colors hover:text-label"
        >
          <Icon name="plus" size={12} />
        </button>
      ) : null}
    </div>
  );
}

function Item({
  icon,
  label,
  count,
  active,
  depth = 0,
  onClick,
  onContextMenu,
}: {
  icon: IconName;
  label: string;
  count: number;
  active: boolean;
  depth?: number;
  onClick: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={depth > 0 ? { paddingLeft: 8 + depth * 18 } : undefined}
      className={`flex w-full items-center gap-2 rounded-md py-[5px] pr-2 pl-2 text-body transition-colors ${
        active ? "bg-accent text-on-accent" : "text-label-2 hover:bg-fill-1 hover:text-label"
      }`}
    >
      <Icon name={icon} size={14} className="shrink-0 opacity-90" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span
        className={`shrink-0 text-footnote tabular-nums ${active ? "opacity-70" : "text-label-3"}`}
      >
        {count || ""}
      </span>
    </button>
  );
}
