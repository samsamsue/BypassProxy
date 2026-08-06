#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
if [ -r "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

LAN_IF="${LAN_IF:-enp3s0}"
LAN_NET="${LAN_NET:-192.168.3.0/24}"
LAN_IP="${LAN_IP:-192.168.3.88}"
TUN_NAME="${TUN_NAME:-sbtun0}"
TUN_DNS="${TUN_DNS:-28.0.0.2}"
PANEL_PORT="${PANEL_PORT:-9091}"
PANEL_SECRET="${PANEL_SECRET:-abc123}"
KERNEL="${KERNEL:-sing-box}"
NS="bp-client-test"
HOST_IF="bpct-host"
CLIENT_IF="bpct-client"
TEST_NET="198.18.88.0/30"
HOST_IP="198.18.88.1"
CLIENT_IP="198.18.88.2"
LOCK_DIR="/tmp/bypassproxy-client-test.lock"
NETNS_ETC="/etc/netns/$NS"

PASS=0
FAIL=0
WARN=0
probe_pid=""

ok() { PASS=$((PASS + 1)); printf "OK   %s\n" "$1"; }
bad() { FAIL=$((FAIL + 1)); printf "FAIL %s\n" "$1"; }
warn() { WARN=$((WARN + 1)); printf "WARN %s\n" "$1"; }

delete_rule() {
  table="$1"
  shift
  iptables -t "$table" -D "$@" >/dev/null 2>&1 || true
}

cleanup() {
  if [ -n "$probe_pid" ]; then
    kill "$probe_pid" >/dev/null 2>&1 || true
    wait "$probe_pid" >/dev/null 2>&1 || true
  fi
  delete_rule nat PREROUTING -i "$HOST_IF" -s "$TEST_NET" -d "$LAN_IP" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS"
  delete_rule nat PREROUTING -i "$HOST_IF" -s "$TEST_NET" -d "$LAN_IP" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS"
  delete_rule nat POSTROUTING -s "$TEST_NET" -o "$LAN_IF" -j MASQUERADE
  delete_rule filter FORWARD -i "$HOST_IF" -o "$TUN_NAME" -s "$TEST_NET" -j ACCEPT
  delete_rule filter FORWARD -i "$TUN_NAME" -o "$HOST_IF" -d "$TEST_NET" -j ACCEPT
  delete_rule filter FORWARD -i "$HOST_IF" -o "$LAN_IF" -s "$TEST_NET" -j ACCEPT
  delete_rule filter FORWARD -i "$LAN_IF" -o "$HOST_IF" -d "$TEST_NET" -j ACCEPT
  ip netns del "$NS" >/dev/null 2>&1 || true
  ip link del "$HOST_IF" >/dev/null 2>&1 || true
  rm -rf "$NETNS_ETC"
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "已有旁路由测试正在运行，请稍后再试。" >&2
  exit 1
fi
trap cleanup EXIT INT TERM

echo "== 旁路由模拟测试 =="
echo "目标旁路由：$LAN_IP"
echo "模拟终端：$CLIENT_IP"
echo "说明：测试服务器侧链路；手机 Wi-Fi 和静态 IP 填写仍需在家确认。"
echo

for command in ip iptables curl python3; do
  if command -v "$command" >/dev/null 2>&1; then
    ok "命令可用：$command"
  else
    bad "缺少命令：$command"
  fi
done

if [ "$FAIL" -gt 0 ]; then
  echo "缺少测试依赖，无法继续。"
  exit 1
fi

kernel_service="mihomo"
[ "$KERNEL" = "mihomo" ] || kernel_service="sing-box"
if systemctl is-active --quiet "$kernel_service" && ip link show "$TUN_NAME" >/dev/null 2>&1; then
  ok "$kernel_service 和 TUN 正在运行"
else
  bad "$kernel_service 或 TUN 未运行"
fi

if ip -4 addr show dev "$LAN_IF" 2>/dev/null | grep -Fq "$LAN_IP"; then
  ok "旁路由 IP 位于 $LAN_IF：$LAN_IP"
else
  bad "旁路由 IP 不在配置网卡上：$LAN_IP / $LAN_IF"
fi

if iptables -C FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT 2>/dev/null \
  && iptables -C FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT 2>/dev/null; then
  ok "家用 LAN 与 TUN 双向转发规则存在"
else
  bad "家用 LAN 与 TUN 转发规则不完整"
fi

if iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null \
  && iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null; then
  ok "手机 DNS 劫持规则存在"
else
  bad "手机把 DNS 设为 $LAN_IP 时所需规则不完整"
fi

if iptables -t nat -C POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE 2>/dev/null; then
  ok "家用 LAN 出口 NAT 规则存在"
else
  bad "家用 LAN 出口 NAT 规则缺失"
fi

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "基础规则未通过，不继续创建模拟终端。请先使用一键修复。"
  exit 1
fi

ip netns del "$NS" >/dev/null 2>&1 || true
ip link del "$HOST_IF" >/dev/null 2>&1 || true
mkdir -p "$NETNS_ETC"
printf "nameserver %s\noptions timeout:2 attempts:2\n" "$LAN_IP" > "$NETNS_ETC/resolv.conf"

ip netns add "$NS"
ip link add "$HOST_IF" type veth peer name "$CLIENT_IF"
ip link set "$CLIENT_IF" netns "$NS"
ip addr add "$HOST_IP/30" dev "$HOST_IF"
ip link set "$HOST_IF" up
ip netns exec "$NS" ip link set lo up
ip netns exec "$NS" ip addr add "$CLIENT_IP/30" dev "$CLIENT_IF"
ip netns exec "$NS" ip link set "$CLIENT_IF" up
ip netns exec "$NS" ip route add default via "$HOST_IP"

iptables -I FORWARD 1 -i "$HOST_IF" -o "$TUN_NAME" -s "$TEST_NET" -j ACCEPT
iptables -I FORWARD 1 -i "$TUN_NAME" -o "$HOST_IF" -d "$TEST_NET" -j ACCEPT
iptables -I FORWARD 1 -i "$HOST_IF" -o "$LAN_IF" -s "$TEST_NET" -j ACCEPT
iptables -I FORWARD 1 -i "$LAN_IF" -o "$HOST_IF" -d "$TEST_NET" -j ACCEPT
iptables -t nat -I POSTROUTING 1 -s "$TEST_NET" -o "$LAN_IF" -j MASQUERADE
iptables -t nat -I PREROUTING 1 -i "$HOST_IF" -s "$TEST_NET" -d "$LAN_IP" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS"
iptables -t nat -I PREROUTING 1 -i "$HOST_IF" -s "$TEST_NET" -d "$LAN_IP" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS"

echo
echo "== 模拟终端联网 =="
if ip netns exec "$NS" python3 - "$LAN_IP" <<'PY'
import random
import socket
import struct
import sys

server = sys.argv[1]
name = "www.baidu.com"
query_id = random.randint(0, 65535)
labels = b"".join(bytes([len(part)]) + part.encode() for part in name.split(".")) + b"\0"
packet = struct.pack("!HHHHHH", query_id, 0x0100, 1, 0, 0, 0) + labels + struct.pack("!HH", 1, 1)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(6)
sock.sendto(packet, (server, 53))
data, _ = sock.recvfrom(4096)
response_id, flags, _, answers, _, _ = struct.unpack("!HHHHHH", data[:12])
if response_id != query_id or flags & 0x000F or answers < 1:
    raise SystemExit(1)
PY
then
  ok "模拟终端通过 $LAN_IP 解析 DNS"
else
  bad "模拟终端通过 $LAN_IP 解析 DNS 失败"
fi

if ip netns exec "$NS" curl --noproxy '*' -fsS --connect-timeout 8 --max-time 15 -o /dev/null https://www.baidu.com/; then
  ok "模拟终端访问国内网站正常"
else
  bad "模拟终端访问国内网站失败"
fi

client_ip="$(ip netns exec "$NS" curl --noproxy '*' -fsS --connect-timeout 10 --max-time 20 https://api.ipify.org 2>/dev/null || true)"
if [ -n "$client_ip" ]; then
  ok "模拟终端访问海外网站正常"
  echo "INFO 模拟终端出口 IP：$client_ip"
else
  bad "模拟终端访问海外网站失败"
fi

ip netns exec "$NS" curl --noproxy '*' -fsS --connect-timeout 10 --max-time 30 --limit-rate 1 \
  -o /dev/null "https://api.ipify.org" >/dev/null 2>&1 &
probe_pid=$!
route_check=""
attempt=0
while kill -0 "$probe_pid" 2>/dev/null && [ "$attempt" -lt 40 ]; do
  connections="$(curl --noproxy '*' -fsS --connect-timeout 2 --max-time 3 \
    -H "Authorization: Bearer $PANEL_SECRET" \
    "http://127.0.0.1:$PANEL_PORT/connections" 2>/dev/null || true)"
  if [ -n "$connections" ]; then
    route_check="$(printf '%s' "$connections" | python3 -c '
import json, sys
try:
    items = json.load(sys.stdin).get("connections", [])
except Exception:
    items = []
for item in items:
    metadata = item.get("metadata") or {}
    if metadata.get("host") != "api.ipify.org":
        continue
    chains = [str(value) for value in item.get("chains") or []]
    lower_chains = {value.casefold() for value in chains}
    print(("VERIFIED|" if "proxy" in lower_chains and "direct" not in lower_chains else "BYPASS|") + " -> ".join(reversed(chains)))
    break
' 2>/dev/null || true)"
    [ -n "$route_check" ] && break
  fi
  attempt=$((attempt + 1))
  sleep 0.25
done
kill "$probe_pid" >/dev/null 2>&1 || true
wait "$probe_pid" >/dev/null 2>&1 || true
probe_pid=""

case "$route_check" in
  VERIFIED\|*)
    ok "海外流量确认经过代理链路"
    echo "INFO 代理链路：${route_check#VERIFIED|}"
    ;;
  BYPASS\|*)
    bad "海外测试连接绕过代理：${route_check#BYPASS|}"
    ;;
  *)
    bad "无法从 $kernel_service 连接表确认海外代理链路"
    ;;
esac

echo
echo "== 结论 =="
echo "OK: $PASS  WARN: $WARN  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "服务器侧旁路由链路未完全通过，建议运行一键修复后重试。"
  exit 1
fi
echo "服务器侧模拟通过。回家后只需确认设备 IP、网关和 DNS 填写正确。"
