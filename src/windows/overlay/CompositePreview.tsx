import { useEffect, useState } from "react";
import { composeOptionsFor } from "@/lib/actions";
import { composeCaption } from "@/lib/compose";
import { blobToObjectUrl, loadPreviewImage, releaseObjectUrl } from "@/lib/image";
import type { Settings } from "@/lib/settings";
import type { Asset } from "@/lib/types";

interface Props {
  asset: Asset;
  settings: Settings;
  /** 合成せず素の画像だけ見せる（キャプションが無いとき）。 */
  plain: boolean;
}

/**
 * 詳細ペインのプレビュー（§6-1「プレビューをオーバーレイの詳細ペインに表示する」）。
 *
 * 合成レイアウトは実寸比で決まるので、**縮小した画像で合成しても**
 * 原寸コピーとまったく同じ見た目になる。プレビューはこの性質を使って軽く保つ。
 */
export function CompositePreview({ asset, settings, plain }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const options = composeOptionsFor(asset, settings);
  const signature = JSON.stringify(options);

  useEffect(() => {
    let alive = true;
    let created: string | null = null;

    // 選択を矢印キーで流していくときに毎回合成しないよう、少しだけ待つ
    const timer = window.setTimeout(async () => {
      try {
        const image = await loadPreviewImage(asset.filePath, 640);
        if (!alive) return;
        const { blob } = await composeCaption(image, plain ? { ...options, lines: [] } : options);
        if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
        if (!alive) return;
        created = blobToObjectUrl(blob);
        setUrl(created);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    }, 110);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      releaseObjectUrl(created);
      setUrl(null);
    };
  }, [asset.id, asset.filePath, signature, plain]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center text-caption text-label-3">
        プレビューを作成できません
      </div>
    );
  }

  if (!url) {
    return <div className="h-full w-full animate-pulse rounded-md bg-fill-1" />;
  }

  // 透過の帯は黒文字なので、暗いオーバーレイの上にそのまま置くと読めない。
  // 市松（＝透過であることの標準的な表現）を敷いて実際の見え方を示す。
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className={`max-h-full max-w-full rounded-md object-contain shadow-[0_1px_6px_rgba(0,0,0,0.2)] ${
        !plain && settings.captionTheme === "transparent" ? "checkerboard" : ""
      }`}
    />
  );
}
