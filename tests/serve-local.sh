#!/bin/sh
# テスト用: 設定(js/config.js)を空にしたコピーを作り、:8765 で配信する。
# 本物の Supabase の値が入っていても、テストは「同じブラウザ内モード」で動く。
# 使い方: sh tests/serve-local.sh &   →  node tests/ui.js など  →  pkill -f "http.server 8765"
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; TMP="${TMPDIR:-/tmp}/kisho-test-site"
rm -rf "$TMP"; mkdir -p "$TMP"; cp -R "$ROOT/index.html" "$ROOT/css" "$ROOT/js" "$ROOT/assets" "$TMP/" 2>/dev/null || true
cat > "$TMP/js/config.js" <<'JS'
window.KISHO_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', notifyFunction: false };
JS
cd "$TMP" && exec python3 -m http.server 8765
