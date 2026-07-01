#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/bypassproxy}"
CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
OUTBOUNDS_JSON="${OUTBOUNDS_JSON:-/etc/bypassproxy/outbounds.json}"
SUBSCRIPTION_CACHE="${SUBSCRIPTION_CACHE:-/etc/bypassproxy/subscription.yaml}"
SUBSCRIPTION_DIR="${SUBSCRIPTION_DIR:-/etc/bypassproxy/subscriptions.d}"
SUBSCRIPTION_CACHE_DIR="${SUBSCRIPTION_CACHE_DIR:-/etc/bypassproxy/subscription-cache.d}"
SUBSCRIPTION_LAST_DIR="${SUBSCRIPTION_LAST_DIR:-$SUBSCRIPTION_CACHE_DIR/last}"
SUBSCRIPTION_MANIFEST="${SUBSCRIPTION_MANIFEST:-$SUBSCRIPTION_CACHE_DIR/manifest.json}"

if [ ! -f "$CONF" ]; then
  echo "缺少配置文件：$CONF" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$CONF"

SUBSCRIBE_URL="${SUBSCRIBE_URL:-}"
SUBSCRIBE_URLS="${SUBSCRIBE_URLS:-}"
SUBSCRIBE_USER_AGENT="${SUBSCRIBE_USER_AGENT:-clash.meta}"
DOWNLOAD_PROXY="${DOWNLOAD_PROXY:-}"
if [ "${BYPASSPROXY_DIRECT_DOWNLOAD:-0}" = "1" ]; then
  DOWNLOAD_PROXY=""
fi

has_managed=0
if [ -d "$SUBSCRIPTION_DIR" ] && find "$SUBSCRIPTION_DIR" -maxdepth 1 -type f -name '*.conf' | grep -q .; then
  has_managed=1
fi

if [ "$has_managed" = "0" ] && [ -z "$SUBSCRIBE_URL" ] && [ -z "$SUBSCRIBE_URLS" ]; then
  echo "订阅/节点地址为空。请运行 sudo bp 修改配置，或编辑 router.conf。" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTBOUNDS_JSON")" "$(dirname "$SUBSCRIPTION_CACHE")" "$SUBSCRIPTION_CACHE_DIR" "$SUBSCRIPTION_LAST_DIR"
find "$SUBSCRIPTION_CACHE_DIR" -maxdepth 1 -type f -name 'source-*.txt' -delete
printf "[]" > "$SUBSCRIPTION_MANIFEST"

download() {
  url="$1"
  out="$2"
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$DOWNLOAD_PROXY" ]; then
      curl -fsSL --retry 2 --retry-all-errors --retry-delay 2 --connect-timeout 15 -A "$SUBSCRIBE_USER_AGENT" -x "$DOWNLOAD_PROXY" -o "$out" "$url"
    else
      curl -fsSL --retry 2 --retry-all-errors --retry-delay 2 --connect-timeout 15 -A "$SUBSCRIBE_USER_AGENT" -o "$out" "$url"
    fi
  else
    wget -q -t 3 -T 15 -U "$SUBSCRIBE_USER_AGENT" -O "$out" "$url"
  fi
}

append_manifest() {
  cache="$1"
  key="$2"
  label="$3"
  python3 - "$SUBSCRIPTION_MANIFEST" "$cache" "$key" "$label" <<'PY'
import json
import sys
from pathlib import Path

manifest = Path(sys.argv[1])
cache = Path(sys.argv[2])
key = sys.argv[3]
label = sys.argv[4]

try:
    data = json.loads(manifest.read_text(encoding="utf-8-sig"))
except Exception:
    data = []
if not isinstance(data, list):
    data = []
data.append({
    "file": cache.name,
    "id": key,
    "name": label or key,
})
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
PY
}

save_source() {
  source="$1"
  label="$2"
  key="${3:-}"
  attempts=$((attempts + 1))
  cache="$SUBSCRIPTION_CACHE_DIR/source-$(printf "%03d" "$attempts").txt"
  if [ -z "$key" ]; then
    key="$(printf "%03d" "$attempts")"
  fi
  last_cache="$SUBSCRIPTION_LAST_DIR/${key}.txt"
  case "$source" in
    vmess://*|vless://*|trojan://*|ss://*|hysteria2://*|hy2://*)
      printf "%s\n" "$source" > "$cache"
      cp "$cache" "$last_cache"
      append_manifest "$cache" "$key" "$label"
      count=$((count + 1))
      ;;
    *)
      echo "正在更新：$label" >&2
      if download "$source" "$cache"; then
        cp "$cache" "$last_cache"
        append_manifest "$cache" "$key" "$label"
        count=$((count + 1))
      elif [ -s "$last_cache" ]; then
        failed=$((failed + 1))
        cp "$last_cache" "$cache"
        append_manifest "$cache" "$key" "$label"
        count=$((count + 1))
        echo "WARN 订阅更新失败，已使用上次成功缓存：$label" >&2
      else
        failed=$((failed + 1))
        rm -f "$cache"
        echo "WARN 订阅更新失败，且没有上次成功缓存，已跳过：$label" >&2
      fi
      ;;
  esac
}

count=0
attempts=0
failed=0
if [ "$has_managed" = "1" ]; then
  for item in "$SUBSCRIPTION_DIR"/*.conf; do
    [ -f "$item" ] || continue
    NAME=""
    URL=""
    ENABLED=1
    # shellcheck disable=SC1090
    . "$item"
    ENABLED="${ENABLED:-1}"
    URL="${URL:-}"
    NAME="${NAME:-$(basename "$item" .conf)}"
    if [ "$ENABLED" = "0" ] || [ -z "$URL" ]; then
      continue
    fi
    key="$(basename "$item" .conf)"
    save_source "$URL" "$NAME" "$key"
  done
fi

for source in $SUBSCRIBE_URL $SUBSCRIBE_URLS; do
  save_source "$source" "$source" "legacy-${attempts}"
done

if [ "$count" -eq 0 ]; then
  if [ "$attempts" -eq 0 ]; then
    echo "没有启用的订阅/节点。" >&2
  else
    echo "所有订阅/节点都更新失败。" >&2
  fi
  exit 1
fi

first_cache="$(find "$SUBSCRIPTION_CACHE_DIR" -maxdepth 1 -type f -name 'source-*.txt' | sort | head -n 1)"
if [ "$count" -eq 1 ] && [ -n "$first_cache" ]; then
  cp "$first_cache" "$SUBSCRIPTION_CACHE"
fi

python3 "$APP_DIR/scripts/extract-outbounds.py" "$SUBSCRIPTION_CACHE_DIR" "$OUTBOUNDS_JSON"
if [ "$failed" -gt 0 ]; then
  echo "有 $failed 个订阅更新失败，已忽略。" >&2
fi
echo "订阅已更新：$OUTBOUNDS_JSON"
