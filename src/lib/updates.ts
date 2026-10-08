/**
 * 自動アップデート。
 *
 * 配布物の署名鍵は `~/.stash/updater.key`（リポジトリ外）。公開鍵だけが
 * `src-tauri/tauri.conf.json` に埋まっている。鍵を失うと既存ユーザーへ
 * 更新を配れなくなるので、必ずバックアップすること。
 */
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; progress: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update = await check();
    return update ? { kind: "available", update } : { kind: "none" };
  } catch (error) {
    // 配布前は endpoint が存在しないので必ずここに来る。異常ではない。
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * ダウンロードしてインストールする。完了後に再起動が要る。
 * 進捗は `onProgress` に 0–1 で流す。
 */
export async function installUpdate(
  update: Update,
  onProgress: (ratio: number) => void,
): Promise<void> {
  let total = 0;
  let received = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress(0);
        break;
      case "Progress":
        received += event.data.chunkLength;
        onProgress(total > 0 ? Math.min(1, received / total) : 0);
        break;
      case "Finished":
        onProgress(1);
        break;
    }
  });
}

export { relaunch };
