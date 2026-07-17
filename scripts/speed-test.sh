#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
if [ -r "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

PROXY_PORT="${PROXY_PORT:-7890}"
PANEL_PORT="${PANEL_PORT:-9091}"
PANEL_SECRET="${PANEL_SECRET:-abc123}"
TEST_BYTES="${SPEED_TEST_BYTES:-20000000}"
TEST_URL="${SPEED_TEST_URL:-https://speed.cloudflare.com/__down?bytes=${TEST_BYTES}}"

case "$PROXY_PORT" in
  ''|*[!0-9]*) echo "代理端口无效：$PROXY_PORT" >&2; exit 1 ;;
esac
case "$TEST_BYTES" in
  ''|*[!0-9]*) echo "测速大小无效：$TEST_BYTES" >&2; exit 1 ;;
esac

lock_dir="/tmp/bypassproxy-speed-test.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "已有测速任务正在运行，请稍后再试。" >&2
  exit 1
fi

result="$(mktemp)"
controller="http://127.0.0.1:$PANEL_PORT"
original_mode=""
mode_changed=0

restore() {
  if [ "$mode_changed" = "1" ] && [ -n "$original_mode" ]; then
    curl --noproxy '*' -fsS -X PATCH \
      -H "Authorization: Bearer $PANEL_SECRET" \
      -H 'Content-Type: application/json' \
      --data "{\"mode\":\"$original_mode\"}" \
      "$controller/configs" >/dev/null 2>&1 || true
  fi
  rm -f "$result"
  rmdir "$lock_dir" 2>/dev/null || true
}
trap restore EXIT INT TERM

config_json="$(curl --noproxy '*' -fsS --connect-timeout 5 -H "Authorization: Bearer $PANEL_SECRET" "$controller/configs")" || {
  echo "无法读取 sing-box 控制接口，不能安全切换全局模式。" >&2
  exit 1
}
original_mode="$(printf '%s' "$config_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("mode") or "Rule")')"
if ! printf '%s' "$config_json" | python3 -c 'import json,sys; raise SystemExit(0 if "Global" in json.load(sys.stdin).get("mode-list", []) else 1)'
then
  echo "当前 sing-box 配置未启用 Global 模式，请先应用最新配置。" >&2
  exit 1
fi

if [ "$original_mode" != "Global" ]; then
  curl --noproxy '*' -fsS -X PATCH \
    -H "Authorization: Bearer $PANEL_SECRET" \
    -H 'Content-Type: application/json' \
    --data '{"mode":"Global"}' \
    "$controller/configs" >/dev/null
  mode_changed=1
fi

echo "通过当前选中节点测速（临时 Global 模式）"
echo "代理：http://127.0.0.1:$PROXY_PORT"
echo "测试流量：约 $(awk -v bytes="$TEST_BYTES" 'BEGIN { printf "%.1f MB", bytes / 1000000 }')"
echo "测速完成后恢复：$original_mode"
echo

if ! curl \
  --proxy "http://127.0.0.1:$PROXY_PORT" \
  --location \
  --fail \
  --show-error \
  --progress-bar \
  --connect-timeout 12 \
  --max-time 60 \
  --output /dev/null \
  --write-out '%{http_code}\n%{size_download}\n%{speed_download}\n%{time_total}\n' \
  "$TEST_URL" > "$result"
then
  echo
  echo "测速失败。请先确认 sing-box 正常运行，并在节点面板选择可用节点。" >&2
  exit 1
fi

http_code="$(sed -n '1p' "$result")"
size_download="$(sed -n '2p' "$result")"
speed_download="$(sed -n '3p' "$result")"
time_total="$(sed -n '4p' "$result")"

echo
awk -v code="$http_code" -v size="$size_download" -v speed="$speed_download" -v seconds="$time_total" 'BEGIN {
  printf "HTTP 状态：%s\n", code
  printf "实际下载：%.2f MB\n", size / 1000000
  printf "耗时：%.2f 秒\n", seconds
  printf "下载速度：%.2f Mbps（%.2f MB/s）\n", speed * 8 / 1000000, speed / 1000000
}'
