#!/usr/bin/env bash
#
# リリースを 1 本作る。
#
#   ./scripts/publish.sh 0.1.1          署名なし（手元・身内向け）
#   ./scripts/publish.sh 0.1.1 --signed 署名 + 公証つき（配布用。release.sh の環境変数が要る）
#
# やること: 3 ファイルの version 更新 → ビルド → latest.json 生成 → タグ → GitHub Release。
# アプリ内更新は latest.json を見に来るので、**これを上げるまで更新は配られない**。

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
[[ -z "$VERSION" ]] && { echo "使い方: ./scripts/publish.sh <version> [--signed]" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version は x.y.z 形式で" >&2; exit 1; }
SIGNED=""
[[ "${2:-}" == "--signed" ]] && SIGNED="--signed"

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
TAG="v$VERSION"
git rev-parse "$TAG" >/dev/null 2>&1 && { echo "エラー: タグ $TAG は既にある" >&2; exit 1; }

echo "==> version を $VERSION に更新"
python3 - "$VERSION" <<'PY'
import json, collections, pathlib, re, sys
v = sys.argv[1]
for path, key in (("package.json", None), ("src-tauri/tauri.conf.json", None)):
    c = json.load(open(path), object_pairs_hook=collections.OrderedDict)
    c["version"] = v
    json.dump(c, open(path, "w"), ensure_ascii=False, indent=2)
    open(path, "a").write("\n")
p = pathlib.Path("src-tauri/Cargo.toml")
p.write_text(re.sub(r'(?m)^version = "[^"]+"', f'version = "{v}"', p.read_text(), count=1))
print("  package.json / tauri.conf.json / Cargo.toml")
PY

echo "==> ビルド"
./scripts/release.sh $SIGNED

BUNDLE=src-tauri/target/release/bundle
TARBALL="$BUNDLE/macos/Stash.app.tar.gz"
SIG="$TARBALL.sig"
[[ -f "$SIG" ]] || { echo "エラー: $SIG が無い。アップデータ署名鍵を確認する" >&2; exit 1; }

echo "==> latest.json を作る"
python3 - "$VERSION" "$REPO" "$TAG" "$SIG" <<'PY'
import datetime, json, sys
version, repo, tag, sig = sys.argv[1:5]
json.dump({
    "version": version,
    "notes": f"Stash {version}",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    # Apple Silicon のみ。Intel も配るなら x86_64 向けを別途ビルドしてここへ足す。
    "platforms": {
        "darwin-aarch64": {
            "signature": open(sig).read().strip(),
            "url": f"https://github.com/{repo}/releases/download/{tag}/Stash.app.tar.gz",
        }
    },
}, open("latest.json", "w"), ensure_ascii=False, indent=2)
PY

echo "==> コミットとタグ"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -qm "$VERSION"
git tag "$TAG"
git push -q origin HEAD --tags

echo "==> GitHub Release"
gh release create "$TAG" --title "Stash $VERSION" --notes "Stash $VERSION" \
  "$TARBALL" "$SIG" latest.json $BUNDLE/dmg/*.dmg
rm -f latest.json

echo
echo "完了: $(gh release view "$TAG" --json url -q .url)"
[[ -z "$SIGNED" ]] && echo "注意: 署名なし。他人の Mac では Gatekeeper に止められる。"
