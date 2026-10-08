/**
 * アイコンは SF Symbols 風のモノトーン線画で統一する（§5 禁止事項:「独自アイコンセット」）。
 * すべて 16×16 のグリッド、線幅 1.3、丸端・丸継ぎ。色は currentColor に従う。
 */
import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "search"
  | "clear"
  | "close"
  | "gear"
  | "plus"
  | "folder"
  | "folderPlus"
  | "photo"
  | "doc"
  | "tag"
  | "trash"
  | "pencil"
  | "chevronRight"
  | "chevronDown"
  | "copy"
  | "caption"
  | "dragOut"
  | "grid"
  | "list"
  | "clock"
  | "check"
  | "warning"
  | "stack"
  | "unlink"
  | "sparkle"
  | "reveal"
  | "info";

/** 歯車の歯。8 方向へ短い線を出す。 */
const GEAR_TEETH = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    x1: round(8 + Math.cos(rad) * 4.5),
    y1: round(8 + Math.sin(rad) * 4.5),
    x2: round(8 + Math.cos(rad) * 6.1),
    y2: round(8 + Math.sin(rad) * 6.1),
  };
});

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="7.1" cy="7.1" r="4.4" />
      <path d="M10.4 10.4 L13.7 13.7" />
    </>
  ),
  clear: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      fill="currentColor"
      stroke="none"
      d="M8 1.55a6.45 6.45 0 1 0 0 12.9 6.45 6.45 0 0 0 0-12.9Zm-2.2 3.5L8 7.25l2.2-2.2.95.95-2.2 2.2 2.2 2.2-.95.95L8 9.15l-2.2 2.2-.95-.95 2.2-2.2-2.2-2.2.95-.95Z"
    />
  ),
  close: <path d="M4.2 4.2 L11.8 11.8 M11.8 4.2 L4.2 11.8" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="4.1" />
      <circle cx="8" cy="8" r="1.7" />
      {GEAR_TEETH.map((t, i) => (
        <path key={i} d={`M${t.x1} ${t.y1} L${t.x2} ${t.y2}`} />
      ))}
    </>
  ),
  plus: <path d="M8 3.4 V12.6 M3.4 8 H12.6" />,
  folder: (
    <path d="M2.2 5.1a1.4 1.4 0 0 1 1.4-1.4h2.6l1.5 1.7h4.7a1.4 1.4 0 0 1 1.4 1.4v4.7a1.4 1.4 0 0 1-1.4 1.4H3.6a1.4 1.4 0 0 1-1.4-1.4Z" />
  ),
  folderPlus: (
    <>
      <path d="M2.2 5.1a1.4 1.4 0 0 1 1.4-1.4h2.6l1.5 1.7h4.7a1.4 1.4 0 0 1 1.4 1.4v4.7a1.4 1.4 0 0 1-1.4 1.4H3.6a1.4 1.4 0 0 1-1.4-1.4Z" />
      <path d="M8 7.6v3.4M6.3 9.3h3.4" />
    </>
  ),
  photo: (
    <>
      <rect x="2.3" y="3.4" width="11.4" height="9.2" rx="1.9" />
      <circle cx="5.9" cy="6.7" r="1.05" />
      <path d="M3 11.4 L6.5 8.3 L8.8 10.4 L10.5 8.9 L13.6 11.6" />
    </>
  ),
  doc: (
    <>
      <path d="M4 2.6h4.5L12.4 6.4v7a1.4 1.4 0 0 1-1.4 1.4H4a1.4 1.4 0 0 1-1.4-1.4V4a1.4 1.4 0 0 1 1.4-1.4Z" />
      <path d="M8.4 2.7v2.8a1.1 1.1 0 0 0 1.1 1.1h2.7" />
    </>
  ),
  tag: (
    <>
      <path d="M7.4 2.6H12a1.4 1.4 0 0 1 1.4 1.4v4.6a1.4 1.4 0 0 1-.41.99l-4.6 4.6a1.4 1.4 0 0 1-1.98 0L2.42 9.59a1.4 1.4 0 0 1 0-1.98l4.6-4.6a1.4 1.4 0 0 1 .38-.41Z" />
      <circle cx="10.3" cy="5.7" r="1.05" />
    </>
  ),
  trash: (
    <>
      <path d="M2.9 4.4h10.2" />
      <path d="M6.2 4.3V3.2a1 1 0 0 1 1-1h1.6a1 1 0 0 1 1 1v1.1" />
      <path d="M4.1 4.4l.55 8.05a1.3 1.3 0 0 0 1.3 1.2h4.1a1.3 1.3 0 0 0 1.3-1.2L11.9 4.4" />
      <path d="M6.9 6.9v4.2M9.1 6.9v4.2" />
    </>
  ),
  pencil: (
    <>
      <path d="M11.05 2.75a1.6 1.6 0 0 1 2.2 2.2L5.7 12.5l-3 .8.8-3Z" />
      <path d="M10.2 3.6l2.2 2.2" />
    </>
  ),
  chevronRight: <path d="M6.2 3.6 L10.6 8 L6.2 12.4" />,
  chevronDown: <path d="M3.6 6.2 L8 10.6 L12.4 6.2" />,
  copy: (
    <>
      <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.7" />
      <path d="M10.6 5.3V4a1.6 1.6 0 0 0-1.6-1.6H4a1.6 1.6 0 0 0-1.6 1.6v5a1.6 1.6 0 0 0 1.6 1.6h1.3" />
    </>
  ),
  caption: (
    <>
      <rect x="2.3" y="2.6" width="11.4" height="7.4" rx="1.7" />
      <path d="M2.9 8.2 L5.9 5.6 L8 7.3 L9.5 6.1 L13.1 9" />
      <path d="M4.4 12.6h7.2M6.1 14.4h3.8" />
    </>
  ),
  dragOut: (
    <>
      <path d="M8.4 2.6h3.6a1.4 1.4 0 0 1 1.4 1.4v3.6" />
      <path d="M13.4 2.6 L8.6 7.4" />
      <path d="M11.1 9.4v2.6a1.4 1.4 0 0 1-1.4 1.4H4a1.4 1.4 0 0 1-1.4-1.4V6.3A1.4 1.4 0 0 1 4 4.9h2.6" />
    </>
  ),
  grid: (
    <>
      <rect x="2.5" y="2.5" width="4.7" height="4.7" rx="1.3" />
      <rect x="8.8" y="2.5" width="4.7" height="4.7" rx="1.3" />
      <rect x="2.5" y="8.8" width="4.7" height="4.7" rx="1.3" />
      <rect x="8.8" y="8.8" width="4.7" height="4.7" rx="1.3" />
    </>
  ),
  list: (
    <>
      <path d="M5.6 4.2h8M5.6 8h8M5.6 11.8h8" />
      <path d="M2.9 4.2h.01M2.9 8h.01M2.9 11.8h.01" strokeWidth="1.7" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 4.7V8.2l2.4 1.5" />
    </>
  ),
  check: <path d="M3.2 8.6 L6.4 11.7 L12.8 4.9" />,
  warning: (
    <>
      <path d="M7.06 3.05a1.1 1.1 0 0 1 1.88 0l4.6 7.9a1.1 1.1 0 0 1-.94 1.65H3.4a1.1 1.1 0 0 1-.94-1.65Z" />
      <path d="M8 6.5v2.4M8 10.9h.01" />
    </>
  ),
  stack: (
    <>
      <rect x="2.5" y="7.6" width="11" height="5.9" rx="1.6" />
      <path d="M4.1 5.5h7.8M5.5 3.2h5" />
    </>
  ),
  unlink: (
    <>
      <path d="M6.6 9.4 5.1 10.9a2.4 2.4 0 0 1-3.4-3.4l1.5-1.5" />
      <path d="M9.4 6.6l1.5-1.5a2.4 2.4 0 0 1 3.4 3.4l-1.5 1.5" />
      <path d="M2.6 2.6 L13.4 13.4" />
    </>
  ),
  sparkle: (
    <path d="M8 2.2l1.35 3.05L12.4 6.6 9.35 7.95 8 11 6.65 7.95 3.6 6.6l3.05-1.35Z" />
  ),
  reveal: (
    <>
      <path d="M2.6 12.4V4.6a1.4 1.4 0 0 1 1.4-1.4h2.3l1.4 1.6h4.3a1.4 1.4 0 0 1 1.4 1.4v6.2a1.4 1.4 0 0 1-1.4 1.4H4a1.4 1.4 0 0 1-1.4-1.4Z" />
      <path d="M6.9 9.1 L10.2 9.1 L10.2 12.4" transform="rotate(-45 8.5 10.7)" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M8 7.2v3.6M8 5.2h.01" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** 太めに見せたいときだけ。基本は既定のままにする。 */
  strokeWidth?: number;
}

export function Icon({ name, size = 16, className, style, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
