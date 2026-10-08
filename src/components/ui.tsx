/**
 * 共通の小さな UI 部品。macOS のシステム設定にある部品の見え方を基準にする。
 * 装飾は足さない。グラデーションボタンや色つきタグは使わない（§5 禁止事項）。
 */
import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type ButtonVariant = "plain" | "accent" | "quiet" | "danger" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
}

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  plain:
    "bg-fill-1 text-label hover:bg-fill-2 active:bg-fill-3 shadow-[0_0.5px_1px_rgba(0,0,0,0.08)]",
  accent: "bg-accent text-on-accent hover:brightness-110 active:brightness-95",
  quiet: "text-label-2 hover:bg-fill-1 hover:text-label",
  danger: "text-danger hover:bg-fill-1",
  // 破壊的な操作が既定ボタンになる場面（削除の確認など）だけ塗りつぶす
  destructive: "bg-danger text-white hover:brightness-110 active:brightness-95",
};

export function Button({
  variant = "plain",
  icon,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-[26px] shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-body whitespace-nowrap transition-[background-color,filter] duration-75 disabled:pointer-events-none disabled:opacity-40 ${BUTTON_STYLES[variant]} ${className}`}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: IconName }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md text-label-2 transition-colors hover:bg-fill-1 hover:text-label disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

export function TextField({
  label,
  hint,
  emphasized = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  /** ★ キャプション欄など、目立たせたい入力に使う（§7）。 */
  emphasized?: boolean;
}) {
  return (
    <label className="block space-y-1">
      {label ? (
        <span
          className={`block ${emphasized ? "text-caption font-semibold text-label" : "text-caption text-label-2"}`}
        >
          {label}
        </span>
      ) : null}
      <input
        {...props}
        className={`w-full rounded-md border bg-surface-raised px-2 py-1.5 text-body text-label placeholder:text-label-3 focus:border-accent focus:outline-none ${
          emphasized
            ? "border-separator-strong shadow-[0_0_0_3px_var(--accent-soft)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            : "border-separator"
        }`}
      />
      {hint ? <span className="block text-footnote text-label-3">{hint}</span> : null}
    </label>
  );
}

/**
 * macOS のシステム設定と同じ寸法感のスイッチ（トラック 38×22 / ノブ 18）。
 * オフは窪んで見えるよう内側に薄い縁を入れ、オンはアクセント 1 色で塗る。
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors duration-200 ease-out disabled:opacity-40 ${
        checked
          ? "bg-accent"
          : "bg-fill-3 shadow-[inset_0_0_0_0.5px_var(--separator-strong)]"
      }`}
    >
      <span
        className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-pill bg-white transition-transform duration-200 ease-out"
        style={{
          transform: checked ? "translateX(16px)" : "none",
          boxShadow: "0 1px 2.5px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(0,0,0,0.06)",
        }}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-fill-1 p-[2px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-[6px] px-2.5 py-[3px] text-caption transition-colors ${
            value === option.value
              ? "bg-surface text-label shadow-[0_0.5px_1.5px_rgba(0,0,0,0.14)]"
              : "text-label-2 hover:text-label"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 小さなポップオーバー。ボタンを押すと下に開き、外側クリック / Esc で閉じる。
 * 全画面バックドロップは置かない（下の要素のクリックを奪ってしまうため）。
 */
export function Popover({
  label,
  icon,
  children,
  align = "right",
}: {
  label: ReactNode;
  icon?: IconName;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-body whitespace-nowrap transition-colors ${
          open ? "bg-fill-2 text-label" : "text-label-2 hover:bg-fill-1 hover:text-label"
        }`}
      >
        {icon ? <Icon name={icon} size={14} /> : null}
        {label}
        <Icon name="chevronDown" size={11} className="text-label-3" />
      </button>

      {open ? (
        <div
          className={`absolute top-[30px] z-30 min-w-[176px] rounded-lg border border-separator bg-surface p-1 shadow-[0_8px_28px_rgba(0,0,0,0.22)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 右クリックメニュー。カーソル位置に開き、外側クリック / Esc / スクロールで閉じる。
 * 画面端で切れないよう、はみ出すぶんだけ内側へずらす。
 */
export function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPos({
      left: Math.min(x, window.innerWidth - box.width - 8),
      top: Math.min(y, window.innerHeight - box.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // capture 段階で拾う。メニュー自身の onMouseDown は stopPropagation で守る。
    document.addEventListener("mousedown", close);
    document.addEventListener("wheel", close, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("wheel", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(event) => event.stopPropagation()}
      className="fixed z-[70] min-w-[168px] rounded-lg border border-separator bg-surface p-1 shadow-[0_8px_28px_rgba(0,0,0,0.24)]"
    >
      {children(onClose)}
    </div>
  );
}

export function MenuItem({
  label,
  selected = false,
  tone = "normal",
  showCheck = true,
  onClick,
}: {
  label: string;
  selected?: boolean;
  tone?: "normal" | "danger";
  /** チェック欄を出すか。選択状態を持たないメニューでは false にして余白を詰める。 */
  showCheck?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-body transition-colors ${
        tone === "danger"
          ? "text-danger hover:bg-danger hover:text-white"
          : "text-label hover:bg-accent hover:text-on-accent"
      }`}
    >
      {showCheck ? (
        <span className="w-[14px] shrink-0">
          {selected ? <Icon name="check" size={12} /> : null}
        </span>
      ) : null}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-separator" />;
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-body text-label">{label}</p>
        {hint ? <p className="mt-0.5 text-caption leading-snug text-label-3">{hint}</p> : null}
      </div>
      <div className="shrink-0 pt-[1px]">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="px-0.5 text-caption font-semibold tracking-wide text-label-2">{title}</h3>
      <div className="divide-y divide-separator rounded-lg border border-separator bg-surface-raised px-3">
        {children}
      </div>
    </section>
  );
}
