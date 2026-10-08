#!/usr/bin/env bash
#
# Stash のリリースビルド。
#
#   ./scripts/release.sh            署名なし（手元で試すだけ）
#   ./scripts/release.sh --signed   署名 + 公証つき（配布用）
#
# --signed のときに必要な環境変数（このスクリプトは値を保存も表示もしない）:
#
#   APPLE_SIGNING_IDENTITY  例: "Developer ID Application: Your Name (TEAMID)"
#                           `security find-identity -v -p codesigning` で確認できる
#   APPLE_ID                Apple Developer アカウントのメールアドレス
#   APPLE_PASSWORD          appleid.apple.com で発行する App 用パスワード
#                           （Apple ID のパスワード本体ではない）
#   APPLE_TEAM_ID           10 桁のチーム ID
#
#   TAURI_SIGNING_PRIVATE_KEY           アップデータ署名鍵のパス or 中身
#                                       既定 ~/.stash/updater.key
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  鍵にパスワードを付けた場合のみ
#
# 環境変数はシェルの履歴に残さないこと。direnv や 1Password CLI 経由が安全。

set -euo pipefail
cd "$(dirname "$0")/.."

SIGNED=0
[[ "${1:-}" == "--signed" ]] && SIGNED=1

UPDATER_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.stash/updater.key}"
if [[ -f "$UPDATER_KEY" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$UPDATER_KEY"
  # 未定義のままだと Tauri が対話でパスワードを聞きに来てビルドが止まる。
  # 鍵にパスワードを付けていない場合は空文字を明示的に渡す。
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
else
  echo "警告: アップデータ署名鍵が見つかりません ($UPDATER_KEY)"
  echo "      更新用の成果物（.sig）は作られません。"
  echo "      作り直す場合: pnpm tauri signer generate -w ~/.stash/updater.key"
fi

if [[ $SIGNED -eq 1 ]]; then
  missing=()
  for v in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
    [[ -z "${!v:-}" ]] && missing+=("$v")
  done
  if (( ${#missing[@]} > 0 )); then
    echo "エラー: 次の環境変数が未設定です: ${missing[*]}" >&2
    exit 1
  fi
  echo "署名 + 公証つきでビルドします（公証は数分かかります）"
else
  echo "署名なしでビルドします。配布するなら --signed を付けてください。"
fi

pnpm install --frozen-lockfile
pnpm tauri build

echo
echo "成果物:"
find src-tauri/target/release/bundle -maxdepth 2 -type f \
  \( -name '*.dmg' -o -name '*.app.tar.gz' -o -name '*.sig' -o -name '*.msi' -o -name '*-setup.exe' \) \
  -exec ls -lh {} \; | awk '{print "  " $NF " (" $5 ")"}'

if [[ $SIGNED -eq 1 ]]; then
  APP="src-tauri/target/release/bundle/macos/Stash.app"
  echo
  echo "署名の確認:"
  codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/  /'
  echo "公証の確認（accepted と出れば OK）:"
  spctl --assess --type execute --verbose "$APP" 2>&1 | sed 's/^/  /'
fi
