#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

LAN_IF="${LAN_IF:-enp3s0}"
LAN_NET="${LAN_NET:-192.168.3.0/24}"
TUN_ENABLE="${TUN_ENABLE:-1}"
TUN_NAME="${TUN_NAME:-sbtun0}"

is_enabled() {
  case "$(printf "%s" "$1" | tr 'A-Z' 'a-z')" in
    0|false|off|no|disable|disabled|关|关闭) return 1 ;;
    *) return 0 ;;
  esac
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
  iptables -C FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD 1 -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT

  iptables -C FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD 1 -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT
else
  iptables -D FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT 2>/dev/null || true
  iptables -D FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT 2>/dev/null || true
fi

iptables -t nat -C POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE

iptables -t mangle -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN 2>/dev/null \
  || iptables -t mangle -I PREROUTING 1 -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN
