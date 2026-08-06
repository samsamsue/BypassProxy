#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
if [ -r "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

SPEED_TEST_PORT="${SPEED_TEST_PORT:-7891}"
PANEL_PORT="${PANEL_PORT:-9091}"
PANEL_SECRET="${PANEL_SECRET:-abc123}"
TEST_BYTES="${SPEED_TEST_BYTES:-50000000}"
TEST_URL="${SPEED_TEST_URL:-https://speed.cloudflare.com/__down?bytes=${TEST_BYTES}}"
KERNEL="${KERNEL:-sing-box}"

case "$SPEED_TEST_PORT" in
  ''|*[!0-9]*) echo "测速代理端口无效：$SPEED_TEST_PORT" >&2; exit 1 ;;
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
cleanup() {
  rm -f "$result"
  rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "通过当前选中节点测速（本机专用代理入口）"
echo "测速入口：http://127.0.0.1:$SPEED_TEST_PORT"
echo "测试流量：约 $(awk -v bytes="$TEST_BYTES" 'BEGIN { printf "%.1f MB", bytes / 1000000 }')"
echo

curl \
  --proxy "http://127.0.0.1:$SPEED_TEST_PORT" \
  --location \
  --fail \
  --show-error \
  --progress-bar \
  --connect-timeout 12 \
  --max-time 60 \
  --output /dev/null \
  --write-out '%{http_code}\n%{size_download}\n%{speed_download}\n%{time_total}\n' \
  "$TEST_URL" > "$result" &
curl_pid=$!

route_check=""
attempt=0
while kill -0 "$curl_pid" 2>/dev/null && [ "$attempt" -lt 60 ]; do
  connections="$(curl --noproxy '*' -fsS --connect-timeout 2 \
    -H "Authorization: Bearer $PANEL_SECRET" \
    "http://127.0.0.1:$PANEL_PORT/connections" 2>/dev/null || true)"
  if [ -n "$connections" ]; then
    route_check="$(printf '%s' "$connections" | KERNEL="$KERNEL" python3 -c '
import json, sys
import os
try:
    items = json.load(sys.stdin).get("connections", [])
except Exception:
    items = []
kernel = os.environ.get("KERNEL", "sing-box").casefold()
for item in items:
    metadata = item.get("metadata") or {}
    if metadata.get("host") != "speed.cloudflare.com":
        continue
    connection_type = str(metadata.get("type") or "").casefold()
    inbound_name = str(metadata.get("inboundName") or "").casefold()
    if kernel == "mihomo":
        if inbound_name != "speed-test-in" and connection_type not in {"mixed/speed-test-in", "mixed"}:
            continue
    elif connection_type != "mixed/speed-test-in":
        continue
    chains = [str(value) for value in item.get("chains") or []]
    lower_chains = {value.casefold() for value in chains}
    valid = "proxy" in lower_chains and "direct" not in lower_chains
    print(("VERIFIED|" if valid else "BYPASS|") + " -> ".join(reversed(chains)))
    break
' 2>/dev/null || true)"
    [ -n "$route_check" ] && break
  fi
  attempt=$((attempt + 1))
  sleep 0.25
done

case "$route_check" in
  BYPASS\|*)
    kill "$curl_pid" 2>/dev/null || true
    wait "$curl_pid" 2>/dev/null || true
    echo
    echo "测速连接未经过 proxy，已停止测试：${route_check#BYPASS|}" >&2
    exit 1
    ;;
esac

curl_status=0
wait "$curl_pid" || curl_status=$?
if [ "$curl_status" -ne 0 ]; then
  echo
  echo "测速失败。请先确认 $KERNEL 正常运行，并在节点面板选择可用节点。" >&2
  exit 1
fi

case "$route_check" in
  VERIFIED\|*) echo "已确认代理链路：${route_check#VERIFIED|}" ;;
  *) echo "无法从 $KERNEL 活动连接确认代理链路，本次结果作废。" >&2; exit 1 ;;
esac

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
