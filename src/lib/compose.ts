/**
 * ★ キャプション合成（§6-1 の看板機能）— 独立モジュール。
 *
 * 画像の下（または上）にキャプション帯を足した 1 枚の画像を作る。
 * Tauri にも DOM の外側にも依存しない純粋な描画処理なので、
 * 将来レイアウトを増やす（ラベル位置変更・複数行）ときもここだけで完結する。
 *
 * 画質について（§11）:
 * - 合成は **元画像の解像度そのまま** で行う。サムネからは絶対に合成しない。
 * - 帯のサイズ・文字サイズはすべて画像の実寸に対する比率で決める。
 *   これにより、プレビュー用に縮小した画像で合成しても見た目の比率が完全に一致する。
 */

export type CaptionPlacement = "bottom" | "top";
/**
 * 帯の見た目。
 * - `transparent`: 帯は塗らず、黒文字だけを置く（既定）。白背景の資料やメールに
 *   貼ったとき、画像の下に文字だけが乗っているように見える。
 * - `light` / `dark`: 塗りつぶした帯。背景が一定しない場所へ貼るとき用。
 */
export type CaptionTheme = "transparent" | "light" | "dark";

/**
 * 文字が画像の幅に収まらないときの扱い。
 * - `fit`: 画像の幅に合わせて折り返す（収まらなければ末尾を省略）。出力の幅は元画像のまま。
 * - `extend`: 文字サイズを優先し、**キャンバスを横に広げて画像枠を超えさせる**。
 *   折り返しも省略もしない。画像は広がったキャンバスの中央に置かれる。
 */
export type CaptionFit = "fit" | "extend";

export interface ComposeOptions {
  /** 1 要素なら折り返し対象、複数要素ならそれぞれが 1 行（メーカー名 + 型番 など）。 */
  lines: string[];
  placement?: CaptionPlacement;
  theme?: CaptionTheme;
  /**
   * 文字の高さ。**画像の基準寸法に対する比率**（0.032 なら 3.2%）。
   * 絶対 px ではないので、解像度の違う素材どうしで見た目の比率が揃う。
   */
  fontRatio?: number;
  align?: "center" | "left";
  /** 単一キャプションを折り返す最大行数（§6-1: 既定 2 行）。`extend` では無視される。 */
  maxLines?: number;
  fit?: CaptionFit;
}

export interface ComposeResult {
  blob: Blob;
  width: number;
  height: number;
}

/** 描画対象にできる画像。ImageBitmap が使えない環境では <img> を渡す。 */
export type Drawable = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif';

/** 文字の高さの既定値。画像の基準寸法の 3.2%。 */
export const DEFAULT_FONT_RATIO = 0.032;
/** 設定スライダーの範囲（画像に対する比率）。 */
export const FONT_RATIO_MIN = 0.01;
export const FONT_RATIO_MAX = 0.2;
const LINE_HEIGHT = 1.3;
const PADDING_RATIO = 0.52; // フォントサイズに対する上下パディング
const SECONDARY_SCALE = 0.78;

const PALETTE: Record<
  CaptionTheme,
  { band: string | null; primary: string; secondary: string; divider: string | null }
> = {
  // 帯を塗らないので divider も引かない（透過の上に線だけ浮くと汚い）
  transparent: {
    band: null,
    primary: "#000000",
    secondary: "rgba(0,0,0,0.55)",
    divider: null,
  },
  light: {
    band: "#ffffff",
    primary: "rgba(0,0,0,0.88)",
    secondary: "rgba(0,0,0,0.5)",
    divider: "rgba(0,0,0,0.1)",
  },
  dark: {
    band: "#1c1c1e",
    primary: "rgba(255,255,255,0.92)",
    secondary: "rgba(255,255,255,0.56)",
    divider: "rgba(255,255,255,0.13)",
  },
};

/**
 * 文字サイズの基準にする寸法。
 * - `fit`: 幅と高さの小さい方（極端な横長画像で文字が巨大になるのを防ぐ）
 * - `extend`: **幅だけ**。画像枠を超えてよいモードなので縦で頭打ちにしない。
 *   これが無いと、小さいロゴ等で比率を上げても枠を超えるサイズにできない。
 */
function referenceSize(width: number, height: number, fit: CaptionFit): number {
  return fit === "extend" ? width : Math.min(width, height * 1.5);
}

/**
 * 実際に描かれる文字サイズ（px）。比率 × 基準寸法。
 *
 * **px の上限・下限は設けない。** 設定はあくまで画像に対する比率であり、
 * ここで絶対値に丸めると「大きい画像だけ頭打ち」のような非相対的な挙動になる。
 */
export function captionFontSizeFor(
  width: number,
  height: number,
  fontRatio = DEFAULT_FONT_RATIO,
  fit: CaptionFit = "fit",
): number {
  return Math.max(1, Math.round(referenceSize(width, height, fit) * fontRatio));
}

function sizeOf(image: Drawable): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  }
  return { width: image.width, height: image.height };
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * OffscreenCanvas を優先し、非対応環境（Safari 16.4 未満 = macOS 12 以前）では
 * 通常の canvas に落ちる。合成結果は同一。
 */
function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas: AnyCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      blob ? resolve(blob) : reject(new Error("画像の書き出しに失敗しました"));
    }, "image/png");
  });
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function font(ctx: Ctx, size: number, weight: number) {
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
}

/** 幅に収まるところで折り返す。日本語は単語境界が無いので 1 文字ずつ詰める。 */
function wrapText(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];

  const chars = Array.from(text); // 絵文字などのサロゲートペアを壊さない
  const lines: string[] = [];
  let current = "";

  for (let i = 0; i < chars.length; i += 1) {
    const next = current + chars[i];
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = chars[i];
      // 最終行に到達したら、残り全部を押し込んで末尾を省略する
      if (lines.length === maxLines - 1) {
        lines.push(truncate(ctx, chars.slice(i).join(""), maxWidth));
        return lines;
      }
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function truncate(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let out = "";
  for (const char of Array.from(text)) {
    if (ctx.measureText(out + char + ellipsis).width > maxWidth) break;
    out += char;
  }
  return out + ellipsis;
}

/**
 * 画像 + キャプション帯を合成して PNG の Blob を返す。
 * `image` に縮小版を渡せばプレビュー用、原寸を渡せばコピー用。比率は変わらない。
 */
export async function composeCaption(
  image: Drawable,
  options: ComposeOptions,
): Promise<ComposeResult> {
  const {
    lines: rawLines,
    placement = "bottom",
    theme = "transparent",
    fontRatio = DEFAULT_FONT_RATIO,
    align = "center",
    maxLines = 2,
    fit = "fit",
  } = options;

  const lines = rawLines.map((l) => l.trim()).filter(Boolean);
  const { width, height } = sizeOf(image);

  if (lines.length === 0 || width === 0 || height === 0) {
    // キャプションが無ければ素の画像をそのまま返す（呼び出し側で分岐させない）
    const canvas = createCanvas(Math.max(width, 1), Math.max(height, 1));
    const ctx = canvas.getContext("2d") as Ctx | null;
    if (!ctx) throw new Error("キャンバスを初期化できませんでした");
    ctx.drawImage(image as CanvasImageSource, 0, 0);
    return { blob: await toBlob(canvas), width, height };
  }

  const colors = PALETTE[theme];
  // 境界線の太さは画像そのものの大きさに合わせる（文字サイズの都合で変えない）
  const reference = Math.min(width, height * 1.5);
  const primarySize = captionFontSizeFor(width, height, fontRatio, fit);
  const secondarySize = Math.round(primarySize * SECONDARY_SCALE);
  const padding = Math.round(primarySize * PADDING_RATIO);
  const dividerWidth = Math.max(1, Math.round(reference * 0.0012));
  const inset = Math.round(padding * 1.4);
  // extend では幅の制約を外す。折り返しも省略も起きず、指定した文字サイズがそのまま出る。
  const textWidth =
    fit === "extend" ? Number.POSITIVE_INFINITY : Math.max(1, width - inset * 2);

  // 行の確定には計測が要るので、いったん最小のキャンバスでコンテキストを借りる
  const scratch = createCanvas(1, 1).getContext("2d") as Ctx | null;
  if (!scratch) throw new Error("キャンバスを初期化できませんでした");

  interface Line {
    text: string;
    size: number;
    weight: number;
    color: string;
  }
  const layout: Line[] = [];

  if (lines.length === 1) {
    font(scratch, primarySize, 590);
    for (const text of wrapText(scratch, lines[0], textWidth, maxLines)) {
      layout.push({ text, size: primarySize, weight: 590, color: colors.primary });
    }
  } else {
    font(scratch, primarySize, 590);
    layout.push({
      text: truncate(scratch, lines[0], textWidth),
      size: primarySize,
      weight: 590,
      color: colors.primary,
    });
    for (const text of lines.slice(1)) {
      font(scratch, secondarySize, 420);
      layout.push({
        text: truncate(scratch, text, textWidth),
        size: secondarySize,
        weight: 420,
        color: colors.secondary,
      });
    }
  }

  const textBlock = layout.reduce((sum, line) => sum + Math.round(line.size * LINE_HEIGHT), 0);
  const bandHeight = textBlock + padding * 2;

  // extend のときだけ、文字がはみ出すぶんキャンバスを横に広げる。
  // fit では必ず元画像の幅のままになる（widest は width 以下に収まっている）。
  let widest = 0;
  for (const line of layout) {
    font(scratch, line.size, line.weight);
    widest = Math.max(widest, scratch.measureText(line.text).width);
  }
  const canvasWidth = Math.max(width, Math.ceil(widest) + inset * 2);
  // 広がったぶんは画像を中央に置く
  const imageLeft = Math.round((canvasWidth - width) / 2);

  const canvas = createCanvas(canvasWidth, height + bandHeight);
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("キャンバスを初期化できませんでした");

  const bandTop = placement === "bottom" ? height : 0;
  const imageTop = placement === "bottom" ? 0 : bandHeight;

  // band が null（透過）のときは塗らない。キャンバスの初期状態のまま = 完全な透明。
  if (colors.band) {
    ctx.fillStyle = colors.band;
    ctx.fillRect(0, bandTop, canvasWidth, bandHeight);
  }
  ctx.drawImage(image as CanvasImageSource, imageLeft, imageTop);

  // 画像と帯の境目。白い被写体 + 白い帯でも境界が分かるようにする。
  // 線は画像の幅ぶんだけ引く（広がった余白まで引くと帯が浮いて見える）。
  if (colors.divider) {
    ctx.fillStyle = colors.divider;
    ctx.fillRect(
      imageLeft,
      placement === "bottom" ? height : bandHeight - dividerWidth,
      width,
      dividerWidth,
    );
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = align === "center" ? "center" : "left";
  const x = align === "center" ? canvasWidth / 2 : inset;

  let cursor = bandTop + padding;
  for (const line of layout) {
    const lineHeight = Math.round(line.size * LINE_HEIGHT);
    font(ctx, line.size, line.weight);
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, x, cursor + lineHeight / 2);
    cursor += lineHeight;
  }

  return { blob: await toBlob(canvas), width: canvasWidth, height: height + bandHeight };
}

/**
 * 合成に使う文字列を決める。`metadata.caption` が第一候補、無ければ `name`（§6-1）。
 * 2 行目以降は `metadata.captionLines`（将来のメーカー名/型番の複数行合成用）。
 */
export function captionLinesFor(source: {
  name: string;
  metadata: { caption?: string; captionLines?: string[] };
}): string[] {
  const head = source.metadata.caption?.trim() || source.name;
  const rest = (source.metadata.captionLines ?? []).map((l) => l.trim()).filter(Boolean);
  return [head, ...rest];
}
