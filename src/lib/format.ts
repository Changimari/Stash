export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatDimensions(width: number | null, height: number | null): string | null {
  return width && height ? `${width} × ${height}` : null;
}

export function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return null;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes} 分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 時間前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

/** 長いパスを「…/親/ファイル名」に縮める。Windows の `\` 区切りも扱う。 */
export function shortenPath(path: string, segments = 2): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= segments) return path;
  return `…${separator}${parts.slice(-segments).join(separator)}`;
}
