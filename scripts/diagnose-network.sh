#!/bin/sh
set -u

CONF="${ROUTER_CONF:-/etc/home-router-singbox/router.conf}"
CONFIG_JSON="${CONFIG_JSON:-/etc/sing-box/config.json}"
RULE_DIR="${RULE_DIR:-/etc/home-router-singbox/rules}"

if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

LAN_IF="${LAN_IF:-enp3s0}"
LAN_NET="${LAN_NET:-192.168.3.0/24}"
LAN_IP="${LAN_IP:-192.168.3.88}"
TUN_NAME="${TUN_NAME:-sbtun0}"
PROXY_PORT="${PROXY_PORT:-7890}"
PANEL_PORT="${PANEL_PORT:-9091}"
DNS1="${DNS1:-223.5.5.5}"
DNS2="${DNS2:-119.29.29.29}"

PASS=0
WARN=0
FAIL=0

ok() {
  PASS=$((PASS + 1))
  printf "OK   %s\n" "$1"
}

warn() {
  WARN=$((WARN + 1))
  printf "WARN %s\n" "$1"
}

bad() {
  FAIL=$((FAIL + 1))
  printf "FAIL %s\n" "$1"
}

info() {
  printf "INFO %s\n" "$1"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

check_cmd() {
  if has_cmd "$1"; then
    ok "命令可用：$1"
  else
    bad "缺少命令：$1"
  fi
}

iptables_has() {
  iptables "$@" >/dev/null 2>&1
}

show_title() {
  printf "\n== %s ==\n" "$1"
}

show_title "基础信息"
echo "配置文件：$CONF"
echo "sing-box 配置：$CONFIG_JSON"
echo "LAN 网卡：$LAN_IF"
echo "LAN IP：$LAN_IP"
echo "LAN 网段：$LAN_NET"
echo "TUN 网卡：$TUN_NAME"
echo "代理端口：$PROXY_PORT"
echo "面板端口：$PANEL_PORT"
echo "DNS：$DNS1 / $DNS2"

show_title "必要命令"
for cmd in ip iptables sysctl ss sing-box; do
  check_cmd "$cmd"
done

show_title "网卡和地址"
if ip link show "$LAN_IF" >/dev/null 2>&1; then
  ok "LAN 网卡存在：$LAN_IF"
else
  bad "LAN 网卡不存在：$LAN_IF"
fi

if ip -4 addr show dev "$LAN_IF" 2>/dev/null | grep -q "$LAN_IP"; then
  ok "LAN IP 在 $LAN_IF 上：$LAN_IP"
else
  warn "没有在 $LAN_IF 上看到 LAN IP：$LAN_IP"
fi

if ip link show "$TUN_NAME" >/dev/null 2>&1; then
  ok "TUN 网卡存在：$TUN_NAME"
else
  bad "TUN 网卡不存在：$TUN_NAME；sing-box TUN 可能没起来"
fi

show_title "系统转发"
if [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)" = "1" ]; then
  ok "IPv4 转发已开启"
else
  bad "IPv4 转发未开启，手机设网关后无法转发"
fi

if [ "$(cat "/proc/sys/net/ipv4/conf/${LAN_IF}/send_redirects" 2>/dev/null)" = "0" ]; then
  ok "$LAN_IF send_redirects 已关闭"
else
  warn "$LAN_IF send_redirects 未关闭"
fi

if [ "$(cat "/proc/sys/net/ipv4/conf/${LAN_IF}/rp_filter" 2>/dev/null)" = "0" ]; then
  ok "$LAN_IF rp_filter 已关闭"
else
  warn "$LAN_IF rp_filter 未关闭"
fi

show_title "iptables 转发规则"
if iptables_has -C FORWARD -i "$LAN_IF" -o "$LAN_IF" -s "$LAN_NET" -j ACCEPT; then
  ok "LAN 同网卡转发已放行"
else
  warn "缺少 LAN 同网卡 FORWARD 放行规则"
fi

if iptables_has -C FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT; then
  ok "LAN -> TUN 已放行"
else
  bad "缺少 LAN -> TUN 放行规则，这是手机设网关不能上网的常见原因"
fi

if iptables_has -C FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT; then
  ok "TUN -> LAN 已放行"
else
  bad "缺少 TUN -> LAN 回包放行规则"
fi

if iptables_has -t nat -C POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE; then
  ok "LAN 出口 NAT 已存在"
else
  warn "缺少 LAN 出口 NAT；同网卡旁路由可能需要它"
fi

if iptables_has -t mangle -C PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN; then
  ok "UDP 443 保护规则已存在"
else
  warn "缺少 UDP 443 保护规则；部分 App/视频/游戏可能受影响"
fi

show_title "sing-box 服务和监听"
if systemctl is-active --quiet sing-box 2>/dev/null; then
  ok "sing-box 服务正在运行"
else
  bad "sing-box 服务没有运行"
fi

if ss -lnt 2>/dev/null | grep -q ":${PROXY_PORT} "; then
  ok "代理端口正在监听：$PROXY_PORT"
else
  bad "代理端口没有监听：$PROXY_PORT"
fi

if ss -lnt 2>/dev/null | grep -q ":${PANEL_PORT} "; then
  ok "面板端口正在监听：$PANEL_PORT"
else
  warn "面板端口没有监听：$PANEL_PORT"
fi

if [ -f "$CONFIG_JSON" ]; then
  if sing-box check -C /etc/sing-box >/dev/null 2>&1; then
    ok "sing-box 配置检查通过"
  else
    bad "sing-box 配置检查失败"
  fi
else
  bad "缺少 sing-box 配置：$CONFIG_JSON"
fi

show_title "分流规则"
if [ -s "$RULE_DIR/geosite-cn.srs" ]; then
  ok "geosite-cn 规则存在"
else
  warn "缺少 geosite-cn 规则，请在 sb 菜单更新国内分流规则"
fi

if [ -s "$RULE_DIR/geoip-cn.srs" ]; then
  ok "geoip-cn 规则存在"
else
  warn "缺少 geoip-cn 规则，请在 sb 菜单更新国内分流规则"
fi

if [ -f "$CONFIG_JSON" ] && grep -q '"rule_set": "geosite-cn"' "$CONFIG_JSON"; then
  ok "配置里启用了 geosite-cn 直连"
else
  warn "配置里没有看到 geosite-cn 直连"
fi

if [ -f "$CONFIG_JSON" ] && grep -q '"rule_set": "geoip-cn"' "$CONFIG_JSON"; then
  ok "配置里启用了 geoip-cn 直连"
else
  warn "配置里没有看到 geoip-cn 直连"
fi

show_title "DNS 和联网测试"
if has_cmd getent && getent hosts baidu.com >/dev/null 2>&1; then
  ok "国内域名解析正常：baidu.com"
else
  warn "国内域名解析失败：baidu.com"
fi

if has_cmd getent && getent hosts google.com >/dev/null 2>&1; then
  ok "国外域名解析有响应：google.com"
else
  warn "国外域名解析失败：google.com"
fi

if has_cmd curl; then
  if [ -n "${PANEL_SECRET:-}" ]; then
    if curl -fsS --connect-timeout 5 --max-time 10 -H "Authorization: Bearer ${PANEL_SECRET}" "http://127.0.0.1:${PANEL_PORT}/configs" >/dev/null 2>&1; then
      ok "面板 API 可访问"
    else
      warn "面板 API 不可访问或密钥不正确"
    fi
  elif curl -fsS --connect-timeout 5 --max-time 10 "http://127.0.0.1:${PANEL_PORT}/configs" >/dev/null 2>&1; then
    ok "面板 API 可访问"
  else
    warn "面板 API 不可访问或需要密钥"
  fi

  if curl -fsS --connect-timeout 8 --max-time 15 --proxy "http://127.0.0.1:${PROXY_PORT}" https://api.ipify.org >/dev/null 2>&1; then
    ok "本机显式代理可访问国外"
  else
    warn "本机显式代理访问国外失败；可能是节点或订阅问题"
  fi

  if curl -fsS --connect-timeout 5 --max-time 10 -I https://www.baidu.com >/dev/null 2>&1; then
    ok "本机直连国内网站正常"
  else
    warn "本机直连国内网站失败"
  fi
else
  warn "缺少 curl，跳过联网测试"
fi

show_title "Docker 容器检查"
if has_cmd docker && docker info >/dev/null 2>&1; then
  running_container="$(docker ps --format '{{.Names}}' 2>/dev/null | head -n 1 || true)"
  if [ -n "$running_container" ]; then
    if docker exec "$running_container" sh -lc 'getent hosts baidu.com >/dev/null 2>&1 || nslookup baidu.com >/dev/null 2>&1' >/dev/null 2>&1; then
      ok "Docker 容器 DNS 正常：$running_container"
    else
      warn "Docker 容器 DNS 可能异常：$running_container"
    fi
  else
    info "没有运行中的 Docker 容器，跳过容器 DNS 检查"
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx openlist; then
    if docker exec openlist sh -lc 'getent hosts api.cloud.189.cn >/dev/null 2>&1 || nslookup api.cloud.189.cn >/dev/null 2>&1' >/dev/null 2>&1; then
      ok "检测到 OpenList，天翼云解析正常"
    else
      warn "检测到 OpenList，但天翼云解析失败"
    fi
  else
    info "未检测到 OpenList，跳过 OpenList 专项检查"
  fi
else
  info "Docker 未安装或未运行，跳过容器检查"
fi

show_title "最近 sing-box 关键日志"
journalctl -u sing-box -n 12 --no-pager 2>/dev/null | sed 's/^/  /' || true

show_title "结论"
echo "OK: $PASS  WARN: $WARN  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "结论：存在会影响旁路由上网的关键问题。优先运行菜单里的“应用旁路由转发/NAT”，再重启 sing-box。"
  exit 1
fi
if [ "$WARN" -gt 0 ]; then
  echo "结论：基础链路可用，但有一些体验或稳定性风险。"
  exit 0
fi
echo "结论：旁路由关键链路看起来正常。"
