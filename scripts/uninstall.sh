#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
BACKUP_ROOT="${BACKUP_ROOT:-/root}"

if [ "$(id -u)" != "0" ]; then
  echo "请用 root 运行：sudo bypassproxy-uninstall.sh" >&2
  exit 1
fi

if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

LAN_IF="${LAN_IF:-enp3s0}"
LAN_NET="${LAN_NET:-192.168.3.0/24}"
TUN_NAME="${TUN_NAME:-sbtun0}"

confirm_uninstall() {
  if [ "${ASSUME_YES:-0}" = "1" ] || [ "${1:-}" = "--yes" ]; then
    return
  fi

  cat <<EOF
即将卸载 BypassProxy 旁路由代理助手，并清理：
  - bp 菜单命令
  - BypassProxy systemd 转发服务/timer
  - BypassProxy Web 管理页服务
  - /etc/bypassproxy
  - /etc/sing-box
  - /opt/bypassproxy
  - /usr/local/share/metacubexd
  - 为 ${LAN_IF} ${LAN_NET} 创建的转发/NAT 规则

卸载前会先备份到 ${BACKUP_ROOT}。
请输入 UNINSTALL 继续：
EOF
  read answer || answer=""
  if [ "$answer" != "UNINSTALL" ]; then
    echo "已取消。"
    exit 0
  fi

  printf "是否同时卸载 sing-box 软件包？[y/N]: "
  read purge_answer || purge_answer=""
  case "$purge_answer" in
    y|Y|yes|YES) PURGE_SINGBOX=1 ;;
    *) PURGE_SINGBOX="${PURGE_SINGBOX:-0}" ;;
  esac
  export PURGE_SINGBOX
}

backup_existing_files() {
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="${BACKUP_ROOT}/bypassproxy-uninstall-backup-${stamp}.tar.gz"
  list="/tmp/bypassproxy-uninstall-backup.$$"
  : > "$list"

  for path in \
    /etc/bypassproxy \
    /etc/sing-box \
    /opt/bypassproxy \
    /usr/local/share/metacubexd \
    /usr/local/share/bypassproxy-admin \
    /etc/systemd/system/bypassproxy-forward.service \
    /etc/systemd/system/bypassproxy-forward.timer \
    /etc/systemd/system/bypassproxy-admin.service \
    /etc/sysctl.d/99-bypassproxy-forward.conf \
    /usr/local/sbin/bypassproxy-forward.sh \
    /usr/local/sbin/bypassproxy-update-subscription.sh \
    /usr/local/sbin/bypassproxy-update-webui.sh \
    /usr/local/sbin/bypassproxy-update-rulesets.sh \
    /usr/local/sbin/bypassproxy-update-core.sh \
    /usr/local/sbin/bypassproxy-backup-sync.sh \
    /usr/local/sbin/bypassproxy-repair.sh \
    /usr/local/sbin/bypassproxy-diagnose-network.sh \
    /usr/local/sbin/bypassproxy-speed-test.sh \
    /usr/local/sbin/bypassproxy-uninstall.sh \
    /usr/local/bin/bp
  do
    if [ -e "$path" ] || [ -L "$path" ]; then
      printf "%s\n" "${path#/}" >> "$list"
    fi
  done

  if [ -s "$list" ]; then
    mkdir -p "$BACKUP_ROOT"
    tar -C / -czf "$backup" -T "$list"
    echo "备份文件：$backup"
  else
    echo "没有需要备份的文件。"
  fi

  rm -f "$list"
}

remove_filter_rule() {
  while iptables -C "$@" 2>/dev/null; do
    iptables -D "$@" 2>/dev/null || break
  done
}

remove_table_rule() {
  table="$1"
  shift
  while iptables -t "$table" -C "$@" 2>/dev/null; do
    iptables -t "$table" -D "$@" 2>/dev/null || break
  done
}

stop_services() {
  systemctl disable --now bypassproxy-admin.service 2>/dev/null || true
  systemctl disable --now bypassproxy-forward.timer 2>/dev/null || true
  systemctl disable --now bypassproxy-forward.service 2>/dev/null || true
  systemctl disable --now sing-box 2>/dev/null || true
  pkill -f 'sing-box' 2>/dev/null || true
}

remove_firewall_rules() {
  remove_filter_rule FORWARD -i "$LAN_IF" -o "$LAN_IF" -s "$LAN_NET" -j ACCEPT
  remove_filter_rule FORWARD -i "$LAN_IF" -o "$TUN_NAME" -s "$LAN_NET" -j ACCEPT
  remove_filter_rule FORWARD -i "$TUN_NAME" -o "$LAN_IF" -d "$LAN_NET" -j ACCEPT
  remove_table_rule nat POSTROUTING -s "$LAN_NET" -o "$LAN_IF" -j MASQUERADE

  remove_table_rule mangle PREROUTING -i "$LAN_IF" -s "$LAN_NET" -p udp --dport 443 -j RETURN
}

remove_files() {
  rm -f \
    /etc/systemd/system/bypassproxy-forward.service \
    /etc/systemd/system/bypassproxy-forward.timer \
    /etc/systemd/system/bypassproxy-admin.service \
    /etc/sysctl.d/99-bypassproxy-forward.conf \
    /usr/local/sbin/bypassproxy-forward.sh \
    /usr/local/sbin/bypassproxy-update-subscription.sh \
    /usr/local/sbin/bypassproxy-update-webui.sh \
    /usr/local/sbin/bypassproxy-update-rulesets.sh \
    /usr/local/sbin/bypassproxy-update-core.sh \
    /usr/local/sbin/bypassproxy-backup-sync.sh \
    /usr/local/sbin/bypassproxy-repair.sh \
    /usr/local/sbin/bypassproxy-diagnose-network.sh \
    /usr/local/sbin/bypassproxy-speed-test.sh \
    /usr/local/bin/bp

  rm -rf \
    /etc/bypassproxy \
    /etc/sing-box \
    /opt/bypassproxy \
    /usr/local/share/metacubexd \
    /usr/local/share/bypassproxy-admin

  systemctl daemon-reload 2>/dev/null || true
}

restore_resolv_conf() {
  if [ "${RESTORE_RESOLV_CONF:-1}" = "1" ]; then
    cat > /etc/resolv.conf <<DNS
nameserver 223.5.5.5
nameserver 119.29.29.29
options timeout:2 attempts:2
DNS
  fi
}

purge_singbox_package() {
  if [ "${PURGE_SINGBOX:-0}" = "1" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get purge -y sing-box || true
      apt-get autoremove -y || true
    elif command -v dpkg >/dev/null 2>&1; then
      dpkg -P sing-box || true
    fi
  fi
}

confirm_uninstall "${1:-}"
backup_existing_files
stop_services
remove_firewall_rules
remove_files
restore_resolv_conf
purge_singbox_package
rm -f /usr/local/sbin/bypassproxy-uninstall.sh

echo "BypassProxy 已卸载。"
echo "如果手机曾经把它设为网关，请把手机网关/DNS 改回主路由。"
