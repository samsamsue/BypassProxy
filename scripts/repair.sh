#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/bypassproxy}"
CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
OUTBOUNDS_JSON="${OUTBOUNDS_JSON:-/etc/bypassproxy/outbounds.json}"
SING_BOX_CONFIG="${SING_BOX_CONFIG:-/etc/sing-box/config.json}"
BUILD_DIR="${BUILD_DIR:-/tmp/bypassproxy-repair}"

if [ "$(id -u)" != "0" ]; then
  echo "请用 root 运行：sudo bypassproxy-repair.sh" >&2
  exit 1
fi

if [ ! -f "$CONF" ]; then
  echo "缺少配置文件：$CONF" >&2
  exit 1
fi

echo "== 准备目录和权限 =="
mkdir -p /etc/bypassproxy/rules /etc/bypassproxy/subscriptions.d /etc/bypassproxy/subscription-cache.d /etc/sing-box "$BUILD_DIR" /usr/local/sbin /usr/local/bin /usr/local/share "$APP_DIR/scripts"
chmod 700 /etc/bypassproxy 2>/dev/null || true

link_entry() {
  src="$APP_DIR/scripts/$1"
  dst="/usr/local/sbin/$2"
  if [ -f "$src" ]; then
    rm -rf "$dst"
    ln -s "$src" "$dst"
    echo "OK $dst"
  else
    echo "WARN 缺少 $src"
  fi
}

echo "== 修复命令入口 =="
if [ -f "$APP_DIR/scripts/bp-menu.sh" ]; then
  rm -rf /usr/local/bin/bp
  ln -s "$APP_DIR/scripts/bp-menu.sh" /usr/local/bin/bp
fi

link_entry bypassproxy-forward.sh bypassproxy-forward.sh
link_entry update-subscription.sh bypassproxy-update-subscription.sh
link_entry update-rulesets.sh bypassproxy-update-rulesets.sh
link_entry update-webui.sh bypassproxy-update-webui.sh
link_entry update-core.sh bypassproxy-update-core.sh
link_entry backup-sync.sh bypassproxy-backup-sync.sh
link_entry diagnose-network.sh bypassproxy-diagnose-network.sh
link_entry speed-test.sh bypassproxy-speed-test.sh
link_entry client-test.sh bypassproxy-client-test.sh
link_entry uninstall.sh bypassproxy-uninstall.sh
link_entry repair.sh bypassproxy-repair.sh

if [ -d "$APP_DIR/webui" ]; then
  rm -rf /usr/local/share/metacubexd
  ln -s "$APP_DIR/webui" /usr/local/share/metacubexd
fi
if [ -d "$APP_DIR/admin-ui" ]; then
  rm -rf /usr/local/share/bypassproxy-admin
  ln -s "$APP_DIR/admin-ui" /usr/local/share/bypassproxy-admin
fi

if [ ! -s "$OUTBOUNDS_JSON" ]; then
  echo "== 节点文件缺失，尝试从订阅生成 =="
  if [ -x /usr/local/sbin/bypassproxy-update-subscription.sh ]; then
    ROUTER_CONF="$CONF" OUTBOUNDS_JSON="$OUTBOUNDS_JSON" /usr/local/sbin/bypassproxy-update-subscription.sh
  else
    echo "缺少订阅更新脚本，无法生成节点。" >&2
    exit 1
  fi
fi

if [ ! -s /etc/bypassproxy/rules/geosite-cn.srs ] || [ ! -s /etc/bypassproxy/rules/geoip-cn.srs ]; then
  echo "== 分流规则缺失，尝试补齐 =="
  if [ -x /usr/local/sbin/bypassproxy-update-rulesets.sh ]; then
    ROUTER_CONF="$CONF" RULE_DIR=/etc/bypassproxy/rules /usr/local/sbin/bypassproxy-update-rulesets.sh
  else
    echo "缺少分流规则和更新脚本，无法生成有效配置。" >&2
    exit 1
  fi
else
  echo "== 使用现有分流规则，修复过程不联网更新 =="
fi

echo "== 重新生成 sing-box 配置 =="
ROUTER_CONF="$CONF" OUTBOUNDS_JSON="$OUTBOUNDS_JSON" OUTPUT="$SING_BOX_CONFIG" python3 "$APP_DIR/scripts/render-config.py"

echo "== 检查配置 =="
sing-box check -C /etc/sing-box

echo "== 重载服务 =="
systemctl daemon-reload
systemctl restart sing-box
systemctl enable --now bypassproxy-forward.timer 2>/dev/null || true

echo "== 重新应用转发/NAT =="
if [ -x /usr/local/sbin/bypassproxy-forward.sh ]; then
  ROUTER_CONF="$CONF" /usr/local/sbin/bypassproxy-forward.sh
else
  echo "WARN 缺少转发脚本。"
fi

if systemctl is-enabled bypassproxy-admin >/dev/null 2>&1 || systemctl is-active bypassproxy-admin >/dev/null 2>&1; then
  echo "== 重启管理后台 =="
  systemctl restart bypassproxy-admin || echo "WARN 管理后台重启失败。"
fi

echo "== 修复完成 =="
systemctl is-active sing-box || true
systemctl is-active bypassproxy-forward.timer || true
systemctl is-active bypassproxy-admin 2>/dev/null || true
