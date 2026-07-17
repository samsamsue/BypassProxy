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
mkdir -p /etc/bypassproxy/rules /etc/bypassproxy/subscriptions.d /etc/bypassproxy/subscription-cache.d /etc/sing-box "$BUILD_DIR" /usr/local/sbin /usr/local/bin "$APP_DIR/scripts"
chmod 700 /etc/bypassproxy 2>/dev/null || true

echo "== 修复命令入口 =="
if [ -f "$APP_DIR/scripts/bp-menu.sh" ]; then
  cp "$APP_DIR/scripts/bp-menu.sh" /usr/local/bin/bp
  chmod 0755 /usr/local/bin/bp
fi

copy_script() {
  src="$APP_DIR/scripts/$1"
  dst="/usr/local/sbin/$2"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    chmod 0755 "$dst"
    echo "OK $dst"
  else
    echo "WARN 缺少 $src"
  fi
}

copy_script bypassproxy-forward.sh bypassproxy-forward.sh
copy_script update-subscription.sh bypassproxy-update-subscription.sh
copy_script update-rulesets.sh bypassproxy-update-rulesets.sh
copy_script update-webui.sh bypassproxy-update-webui.sh
copy_script update-core.sh bypassproxy-update-core.sh
copy_script diagnose-network.sh bypassproxy-diagnose-network.sh
copy_script speed-test.sh bypassproxy-speed-test.sh
copy_script uninstall.sh bypassproxy-uninstall.sh
copy_script repair.sh bypassproxy-repair.sh

if [ ! -s "$OUTBOUNDS_JSON" ]; then
  echo "== 节点文件缺失，尝试从订阅生成 =="
  if [ -x /usr/local/sbin/bypassproxy-update-subscription.sh ]; then
    ROUTER_CONF="$CONF" OUTBOUNDS_JSON="$OUTBOUNDS_JSON" /usr/local/sbin/bypassproxy-update-subscription.sh
  else
    echo "缺少订阅更新脚本，无法生成节点。" >&2
    exit 1
  fi
fi

echo "== 检查/更新分流规则 =="
if [ -x /usr/local/sbin/bypassproxy-update-rulesets.sh ]; then
  ROUTER_CONF="$CONF" RULE_DIR=/etc/bypassproxy/rules /usr/local/sbin/bypassproxy-update-rulesets.sh || echo "WARN 分流规则更新失败，将继续尝试使用现有规则。"
else
  echo "WARN 缺少分流规则更新脚本。"
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
