#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

LAN_IF="${LAN_IF:-enp3s0}"
LAN_NET="${LAN_NET:-192.168.3.0/24}"
LAN_IP="${LAN_IP:-192.168.3.88}"
TUN_ENABLE="${TUN_ENABLE:-1}"
TUN_NAME="${TUN_NAME:-sbtun0}"
TUN_DNS="${TUN_DNS:-28.0.0.2}"
KERNEL="${KERNEL:-sing-box}"

kernel_service() {
  [ "$KERNEL" = "mihomo" ] && printf '%s\n' mihomo || printf '%s\n' sing-box
}

is_enabled() {
  case "$(printf "%s" "$1" | tr 'A-Z' 'a-z')" in
    0|false|off|no|disable|disabled|关|关闭) return 1 ;;
    *) return 0 ;;
  esac
}

cleanup_forwarding() {
  while iptables -C FORWARD -i "$LAN_IF" -o "$LAN_IF" -s "$LAN_NET" -j ACCEPT 2>/dev/null; do
    iptables -D FORWARD -i "$LAN_IF" -o "$LAN_IF" -s "$LAN_NET" -j ACCEPT
  done
  while iptables -C FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT 2>/dev/null; do
    iptables -D FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT
  done
  while iptables -C FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT 2>/dev/null; do
    iptables -D FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT
  done
  while iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null; do
    iptables -t nat -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS"
  done
  while iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null; do
    iptables -t nat -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS"
  done
  while iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null; do
    iptables -t nat -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS"
  done
  while iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null; do
    iptables -t nat -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS"
  done
  while iptables -t nat -C POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE 2>/dev/null; do
    iptables -t nat -D POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE
  done
  while iptables -t mangle -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN 2>/dev/null; do
    iptables -t mangle -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN
  done
  while iptables -t mangle -C FORWARD -s "$LAN_NET" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null; do
    iptables -t mangle -D FORWARD -s "$LAN_NET" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
  done
}

if [ "${1:-apply}" = "stop" ]; then
  cleanup_forwarding
  echo "已清理 BypassProxy 转发/NAT 规则。"
  exit 0
fi

wait_for_tun() {
  count=0
  while [ "$count" -lt 10 ]; do
    if ip link show "$TUN_NAME" >/dev/null 2>&1; then
      return 0
    fi
    count=$((count + 1))
    sleep 1
  done
  return 1
}

ensure_tun_ready() {
  needs_restart=0

  systemctl is-active --quiet "$(kernel_service)" || needs_restart=1
  ip link show "$TUN_NAME" >/dev/null 2>&1 || needs_restart=1

  if [ "$needs_restart" -eq 1 ]; then
    echo "TUN 路由不完整，正在重启 $(kernel_service) 恢复。"
    systemctl restart "$(kernel_service)"
    wait_for_tun || {
      echo "ERROR $(kernel_service) 重启后仍未创建 TUN 网卡：$TUN_NAME" >&2
      return 1
    }
  fi
}

sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv4.conf.all.send_redirects=0 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.default.send_redirects=0 >/dev/null 2>&1 || true
sysctl -w "net.ipv4.conf.${LAN_IF}.send_redirects=0" >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null 2>&1 || true
sysctl -w "net.ipv4.conf.${LAN_IF}.rp_filter=0" >/dev/null 2>&1 || true

iptables -C FORWARD -i "$LAN_IF" -o "$LAN_IF" -s "$LAN_NET" -j ACCEPT 2>/dev/null \
  || iptables -I FORWARD 1 -i "$LAN_IF" -o "$LAN_IF" -s "$LAN_NET" -j ACCEPT

if is_enabled "$TUN_ENABLE"; then
  ensure_tun_ready

  iptables -C FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD 1 -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT

  iptables -C FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD 1 -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT

  iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null \
    || iptables -t nat -I PREROUTING 1 -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS"

  iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null \
    || iptables -t nat -I PREROUTING 1 -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS"

  iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null \
    || iptables -t nat -I PREROUTING 1 -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS"

  iptables -t nat -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null \
    || iptables -t nat -I PREROUTING 1 -i "$LAN_IF" -s "$LAN_NET" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS"
else
  iptables -D FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT 2>/dev/null || true
  iptables -D FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT 2>/dev/null || true
  iptables -t nat -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null || true
  iptables -t nat -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -d "$LAN_IP" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null || true
  iptables -t nat -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null || true
  iptables -t nat -D PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p tcp --dport 53 -j DNAT --to-destination "$TUN_DNS" 2>/dev/null || true
fi

iptables -t nat -C POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE

iptables -t mangle -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN 2>/dev/null \
  || iptables -t mangle -I PREROUTING 1 -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN

iptables -t mangle -C FORWARD -s "$LAN_NET" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
  || iptables -t mangle -I FORWARD 1 -s "$LAN_NET" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
