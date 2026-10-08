/**
 * 素材に対する操作（コピー / 合成コピー / ドラッグ）を 1 箇所にまとめる。
 * オーバーレイと管理画面が同じ挙動になるよう、両方ここを通す。
 */
import { copyAsset, copyImageWithCaption, type CopyOutcome } from "./clipboard";
import { captionLinesFor, type ComposeOptions } from "./compose";
import { recordUse } from "./db";
import { dragOut } from "./drag";
import type { Settings } from "./settings";
import type { Asset, AssetAction } from "./types";

export interface ActionFeedback {
  tone: "success" | "warning" | "error";
  message: string;
}

/** 設定と素材から合成オプションを組み立てる。合成の見た目に関わる判断はここだけ。 */
export function composeOptionsFor(asset: Asset, settings: Settings): ComposeOptions {
  return {
    lines: captionLinesFor(asset),
    placement: settings.captionPlacement,
    theme: settings.captionTheme,
    fontRatio: settings.captionFontRatio,
    fit: settings.captionFit,
  };
}

export function canCompose(asset: Asset): boolean {
  return asset.type === "image";
}

function describe(outcome: CopyOutcome): ActionFeedback {
  if (outcome.fallbackReason) {
    return { tone: "warning", message: outcome.fallbackReason };
  }
  switch (outcome.kind) {
    case "imageWithCaption":
      return { tone: "success", message: "キャプション付きでコピーしました" };
    case "image":
      return { tone: "success", message: "画像をコピーしました" };
    case "file":
      return { tone: "success", message: "ファイルをコピーしました" };
    case "path":
      return { tone: "success", message: "パスをコピーしました" };
  }
}

export interface PerformOptions {
  settings: Settings;
  /** ドラッグ開始時にオーバーレイを隠すか。管理画面からは常に false。 */
  isOverlay?: boolean;
  onDragFinish?: (result: "Dropped" | "Cancelled") => void;
}

/**
 * 素材に対する操作を実行し、UI に出す結果を返す。
 * 成功したら使用実績を記録して並び順に反映させる（§6-4）。
 */
export async function performAction(
  action: AssetAction,
  asset: Asset,
  options: PerformOptions,
): Promise<ActionFeedback> {
  const { settings, isOverlay = false } = options;

  try {
    switch (action) {
      case "drag": {
        await dragOut(asset, {
          retreat: isOverlay && settings.hideOnDragStart,
          onFinish: options.onDragFinish,
        });
        await recordUse(asset.id);
        return { tone: "success", message: "ドラッグ中" };
      }

      case "copyWithCaption": {
        if (!canCompose(asset)) {
          return {
            tone: "warning",
            message: "画像素材でないためキャプション合成はできません",
          };
        }
        const outcome = await copyImageWithCaption(asset, composeOptionsFor(asset, settings));
        await recordUse(asset.id);
        return describe(outcome);
      }

      case "copy":
      default: {
        const outcome = await copyAsset(asset, {
          allowPathFallback: settings.pathFallbackOnCopy,
        });
        await recordUse(asset.id);
        return describe(outcome);
      }
    }
  } catch (error) {
    return {
      tone: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
