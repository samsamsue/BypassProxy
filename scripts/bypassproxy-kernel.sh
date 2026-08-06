#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
APP_DIR="${APP_DIR:-/opt/bypassproxy}"
OUTBOUNDS_JSON="${OUTBOUNDS_JSON:-/etc/bypassproxy/outbounds.json}"
MIHOMO_CONFIG="${MIHOMO_CONFIG:-/etc/mihomo/config.yaml}"
MIHOMO_BIN="${MIHOMO_BIN:-/usr/local/bin/mihomo}"
MIHOMO_UI_DIR="${MIHOMO_UI_DIR:-$(dirname "$MIHOMO_CONFIG")/ui}"
MIHOMO_DATA_DIR="${MIHOMO_DATA_DIR:-$(dirname "$MIHOMO_CONFIG")}"
MIHOMO_BOOTSTRAP_DATA_DIR="${MIHOMO_BOOTSTRAP_DATA_DIR:-${HOME:-/root}/.config/mihomo}"

[ -f "$CONF" ] && . "$CONF"
KERNEL="${KERNEL:-sing-box}"
MIHOMO_VERSION="${MIHOMO_VERSION:-1.19.20}"
MIHOMO_DOWNLOAD_URL="${MIHOMO_DOWNLOAD_URL:-https://github.com/MetaCubeX/mihomo/releases/download/v${MIHOMO_VERSION}/mihomo-linux-amd64-compatible-v${MIHOMO_VERSION}.gz}"

kernel_service() {
  case "${1:-$KERNEL}" in
    mihomo) printf '%s\n' mihomo ;;
    *) printf '%s\n' sing-box ;;
  esac
}

download() {
  url="$1"
  out="$2"
  proxy="${DOWNLOAD_PROXY:-}"
  if [ -n "$proxy" ]; then
    curl -fL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 -x "$proxy" -o "$out" "$url"
  else
    curl -fL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 -o "$out" "$url"
  fi
}

install_mihomo() {
  if [ -x "$MIHOMO_BIN" ]; then
    return 0
  fi
  tmp="$(mktemp /tmp/mihomo.XXXXXX.gz)"
  trap 'rm -f "$tmp"' EXIT
  echo "正在下载 mihomo：$MIHOMO_DOWNLOAD_URL"
  download "$MIHOMO_DOWNLOAD_URL" "$tmp"
  gzip -dc "$tmp" > "${MIHOMO_BIN}.new"
  chmod 0755 "${MIHOMO_BIN}.new"
  mv "${MIHOMO_BIN}.new" "$MIHOMO_BIN"
  "$MIHOMO_BIN" -v || true
}

render_mihomo() {
  mkdir -p "$(dirname "$MIHOMO_CONFIG")"
  if [ -d "$APP_DIR/webui" ]; then
    mkdir -p "$MIHOMO_UI_DIR"
    cp -a "$APP_DIR/webui/." "$MIHOMO_UI_DIR/"
  fi
  ROUTER_CONF="$CONF" OUTBOUNDS_JSON="$OUTBOUNDS_JSON" OUTPUT="$MIHOMO_CONFIG" \
    python3 "$APP_DIR/scripts/render-mihomo.py"
}

check_mihomo() {
  "$MIHOMO_BIN" -t -f "$MIHOMO_CONFIG"
  # mihomo may download its geodata while validating as root. Persist it in
  # the service working directory so the systemd service can reuse it.
  for data_file in GeoSite.dat geoip.metadb; do
    if [ -s "$MIHOMO_BOOTSTRAP_DATA_DIR/$data_file" ]; then
      install -m 0644 "$MIHOMO_BOOTSTRAP_DATA_DIR/$data_file" "$MIHOMO_DATA_DIR/$data_file"
    fi
  done
}

ensure_mihomo_service() {
  service_file="/etc/systemd/system/mihomo.service"
  if [ ! -f "$service_file" ]; then
    mkdir -p "$(dirname "$service_file")"
    cat > "$service_file" <<SERVICE
[Unit]
Description=BypassProxy mihomo core
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$MIHOMO_BIN -d $(dirname "$MIHOMO_CONFIG") -f $MIHOMO_CONFIG
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE
  fi
  systemctl daemon-reload
}

write_kernel() {
  value="$1"
  python3 - "$CONF" "$value" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
value = sys.argv[2]
lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []
out = []
found = False
for line in lines:
    if line.startswith("KERNEL="):
        out.append(f"KERNEL='{value}'")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"KERNEL='{value}'")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
path.chmod(0o600)
PY
}

switch_kernel() {
  target="$1"
  case "$target" in sing-box|mihomo) ;; *) echo "不支持的内核：$target" >&2; exit 2 ;; esac
  old="${KERNEL:-sing-box}"
  if [ "$target" = "$old" ]; then
    echo "当前已经是 $target"
    exit 0
  fi
  if [ "$target" = mihomo ]; then
    install_mihomo
    render_mihomo
    check_mihomo
    ensure_mihomo_service
  fi
  old_service="$(kernel_service "$old")"
  new_service="$(kernel_service "$target")"
  systemctl disable --now "$old_service" 2>/dev/null || true
  if ! systemctl enable --now "$new_service"; then
    systemctl enable --now "$old_service" 2>/dev/null || true
    echo "启动 $target 失败，已恢复 $old" >&2
    exit 1
  fi
  sleep 2
  if ! systemctl is-active --quiet "$new_service"; then
    systemctl disable --now "$new_service" 2>/dev/null || true
    systemctl enable --now "$old_service" 2>/dev/null || true
    echo "$target 未正常运行，已恢复 $old" >&2
    exit 1
  fi
  write_kernel "$target"
  systemctl restart bypassproxy-forward.timer 2>/dev/null || true
  echo "已切换到 $target"
}

case "${1:-status}" in
  install) install_mihomo ;;
  render) install_mihomo; render_mihomo ;;
  check) install_mihomo; render_mihomo; check_mihomo ;;
  switch) switch_kernel "${2:-}" ;;
  status) echo "当前内核：$KERNEL"; systemctl is-active "$(kernel_service)" || true ;;
  *) echo "用法：$0 {install|render|check|switch sing-box|switch mihomo|status}"; exit 2 ;;
esac
