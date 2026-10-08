/**
 * webview 標準のドロップ処理を殺す。
 *
 * ファイルを webview に落とすと、既定ではブラウザと同じく「そのファイルを開く」
 * 挙動になり、ページごと画像に置き換わってアプリが操作不能になる。
 * Tauri の `dragDropEnabled: true` があれば通常はネイティブ側で横取りされるが、
 * 経路によっては DOM まで届くことがあるので保険としてこちらでも止める。
 *
 * 各窓のエントリで 1 回だけ呼ぶこと。
 */
export function installDropGuard(): void {
  const swallow = (event: DragEvent) => {
    // 入力欄へのテキストドロップまで殺さないよう、ファイルを含むときだけ止める
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
    }
  };

  window.addEventListener("dragover", swallow);
  window.addEventListener("drop", swallow);
}
