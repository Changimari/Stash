/**
 * アプリ内ダイアログ。
 *
 * `window.prompt` / `window.confirm` は Tauri の webview では使えない
 * （ホスト側が入力パネルを実装していないため無反応で null が返る）。
 * テキスト入力や確認が要る場面では必ずこちらを使うこと。
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Category } from "@/lib/types";
import { Button } from "./ui";

function Shell({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div
      className="absolute inset-0 z-[60] flex items-start justify-center bg-black/25 pt-[22vh]"
      onMouseDown={onCancel}
    >
      <div
        className="w-[330px] rounded-window bg-surface p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)] ring-1 ring-black/10"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function PromptDialog({
  title,
  message,
  initialValue = "",
  placeholder,
  confirmLabel = "OK",
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 開いた直後に入力できるようにし、既定値は選択状態にしておく
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Shell onCancel={onCancel}>
      <p className="text-headline font-semibold text-label">{title}</p>
      {message ? <p className="mt-1 text-caption text-label-2">{message}</p> : null}

      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        className="mt-3 w-full rounded-md border border-separator bg-surface-raised px-2 py-1.5 text-body text-label placeholder:text-label-3 focus:border-accent focus:outline-none"
      />

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onCancel}>キャンセル</Button>
        <Button variant="accent" disabled={!value.trim()} onClick={submit}>
          {confirmLabel}
        </Button>
      </div>
    </Shell>
  );
}

/**
 * カテゴリの追加 / 名前変更。
 * 追加のときは親も選べるようにして、右クリックを知らなくても入れ子を作れるようにする。
 */
export function CategoryDialog({
  mode,
  categories,
  initialName = "",
  initialParentId = null,
  onConfirm,
  onCancel,
}: {
  mode: "create" | "rename";
  categories: Category[];
  initialName?: string;
  initialParentId?: number | null;
  /** 名前変更のときは parentId を無視してよい。 */
  onConfirm: (name: string, parentId: number | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [parentId, setParentId] = useState<number | null>(initialParentId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed, parentId);
  };

  /** 「A / B」のように親をたどった名前にして、同名の子でも見分けられるようにする。 */
  const pathOf = (category: Category): string => {
    const parts = [category.name];
    let cursor = category.parentId;
    // 壊れた親子関係でも無限ループしないよう、辿った id を控えておく
    const seen = new Set<number>([category.id]);
    while (cursor != null && !seen.has(cursor)) {
      seen.add(cursor);
      const parent = categories.find((c) => c.id === cursor);
      if (!parent) break;
      parts.unshift(parent.name);
      cursor = parent.parentId;
    }
    return parts.join(" / ");
  };

  return (
    <Shell onCancel={onCancel}>
      <p className="text-headline font-semibold text-label">
        {mode === "create" ? "カテゴリを追加" : "カテゴリ名を変更"}
      </p>

      <input
        ref={inputRef}
        value={name}
        placeholder="機器写真"
        spellCheck={false}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        className="mt-3 w-full rounded-md border border-separator bg-surface-raised px-2 py-1.5 text-body text-label placeholder:text-label-3 focus:border-accent focus:outline-none"
      />

      {mode === "create" ? (
        <label className="mt-3 block">
          <span className="mb-1 block text-caption text-label-2">場所</span>
          <select
            value={parentId ?? ""}
            onChange={(event) =>
              setParentId(event.target.value === "" ? null : Number(event.target.value))
            }
            className="w-full rounded-md border border-separator bg-surface-raised px-2 py-1.5 text-body text-label focus:border-accent focus:outline-none"
          >
            <option value="">最上位</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {pathOf(category)} の中
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onCancel}>キャンセル</Button>
        <Button variant="accent" disabled={!name.trim()} onClick={submit}>
          {mode === "create" ? "追加" : "変更"}
        </Button>
      </div>
    </Shell>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "削除",
  destructive = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Shell onCancel={onCancel}>
      <p className="text-headline font-semibold text-label">{title}</p>
      {message ? <p className="mt-1 text-caption leading-snug text-label-2">{message}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onCancel}>キャンセル</Button>
        <Button variant={destructive ? "destructive" : "accent"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Shell>
  );
}
