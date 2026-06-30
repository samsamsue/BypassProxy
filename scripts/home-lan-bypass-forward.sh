#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/home-router-singbox/router.conf}"
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

LAN_IF="${LAN_IF:-enp3s0}"
LAN_NET="${LAN_NET:-192.168.3.0/24}"
TUN_NAME="${TUN_NAME:-sbtun0}"

sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv4.conf.all.send_redirects=0 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.default.send_redirects=0 >/dev/null 2>&1 || true
sysctl -w "net.ipv4.conf.${LAN_IF}.send_redirects=0" >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null 2>&1 || true
sysctl -w "net.ipv4.conf.${LAN_IF}.rp_filter=0" >/dev/null 2>&1 || true

iptables -C FORWARD -i "$LAN_IF" -o "$LAN_IF" -s "$LAN_NET" -j ACCEPT 2>/dev/null \
  || iptables -I FORWARD 1 -i "$LAN_IF" -o "$LAN_IF" -s "$LAN_NET" -j ACCEPT

iptables -C FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT 2>/dev/null \
  || iptables -I FORWARD 1 -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT

iptables -C FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT 2>/dev/null \
  || iptables -I FORWARD 1 -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT

iptables -t nat -C POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE

iptables -t mangle -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN 2>/dev/null \
  || iptables -t mangle -I PREROUTING 1 -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN
