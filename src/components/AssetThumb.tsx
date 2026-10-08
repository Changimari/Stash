import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { thumbUrl } from "@/lib/image";
import type { Asset } from "@/lib/types";

interface Props {
  asset: Asset;
  className?: string;
  /** 透過画像を市松模様の上に置く（管理画面の大きなプレビュー用）。 */
  checkered?: boolean;
}

/**
 * サムネイル。未生成・生成失敗・リンク切れはプレースホルダに落とす（§11）。
 */
export function AssetThumb({ asset, className = "", checkered = false }: Props) {
  const url = thumbUrl(asset.thumbnailPath);
  const [failed, setFailed] = useState(false);

  // 素材が差し替わったらエラー状態をリセットする
  useEffect(() => setFailed(false), [asset.id, asset.thumbnailPath]);

  if (!url || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 text-label-3 ${className}`}
      >
        <Icon name={asset.type === "image" ? "photo" : "doc"} size={20} />
        {asset.metadata.ext ? (
          <span className="text-footnote uppercase tracking-wide text-label-4">
            {asset.metadata.ext}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`${checkered ? "checkerboard" : ""} ${className}`}>
      <img
        src={url}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
