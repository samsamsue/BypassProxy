#!/bin/sh
set -eu

REPO="${REPO:-samsamsue/BypassProxy}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/bypassproxy-installer}"
APP_DIR="${APP_DIR:-/opt/bypassproxy}"
CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
ARCHIVE_URL="${ARCHIVE_URL:-https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz}"
VERSION_FILE="${VERSION_FILE:-$INSTALL_DIR/.bypassproxy-version}"
APP_VERSION_FILE="${APP_VERSION_FILE:-$APP_DIR/.bypassproxy-version}"
REMOTE_SHA_URL="${REMOTE_SHA_URL:-https://api.github.com/repos/${REPO}/commits/${BRANCH}}"

if [ "$(id -u)" != "0" ]; then
  echo "请用 root 运行：sudo bypassproxy-update-core.sh" >&2
  exit 1
fi

if [ ! -f "$CONF" ]; then
  echo "缺少配置文件：$CONF" >&2
  echo "请先完成安装，再使用更新功能。" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$CONF"

DOWNLOAD_PROXY="${DOWNLOAD_PROXY:-}"
GITHUB_DOWNLOAD_PREFIX="${GITHUB_DOWNLOAD_PREFIX:-}"
GITHUB_DOWNLOAD_PREFIXES="${GITHUB_DOWNLOAD_PREFIXES:-https://gh-proxy.com/ https://ghproxy.net/ https://gh.llkk.cc/}"

ensure_downloader() {
  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
    return
  fi
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y curl ca-certificates tar
  else
    echo "缺少 curl/wget，且无法自动安装依赖。" >&2
    exit 1
  fi
}

download_urls() {
  url="$1"
  case "$url" in
    https://github.com/*|https://raw.githubusercontent.com/*)
      if [ -n "$GITHUB_DOWNLOAD_PREFIX" ]; then
        printf "%s%s" "$GITHUB_DOWNLOAD_PREFIX" "$url"
        return
      fi
      printf "%s" "$url"
      for prefix in $GITHUB_DOWNLOAD_PREFIXES; do
        printf " %s%s" "$prefix" "$url"
      done
      return
      ;;
  esac
  printf "%s" "$url"
}

download_once() {
  url="$1"
  out="$2"
  partial="${out}.part"
  rm -f "$partial"
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$DOWNLOAD_PROXY" ]; then
      curl -fL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 --speed-limit 10240 --speed-time 30 -x "$DOWNLOAD_PROXY" -o "$partial" "$url" || return 1
    else
      curl -fL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 --speed-limit 10240 --speed-time 30 -o "$partial" "$url" || return 1
    fi
  else
    if [ -n "$DOWNLOAD_PROXY" ]; then
      HTTPS_PROXY="$DOWNLOAD_PROXY" HTTP_PROXY="$DOWNLOAD_PROXY" wget -O "$partial" "$url" || return 1
    else
      wget -O "$partial" "$url" || return 1
    fi
  fi
  [ -s "$partial" ] || return 1
  mv "$partial" "$out"
}

download() {
  url="$1"
  out="$2"
  echo "正在下载项目更新：$url" >&2
  for real_url in $(download_urls "$url"); do
    if download_once "$real_url" "$out"; then
      return 0
    fi
    echo "下载失败，尝试下一个地址：$real_url" >&2
  done
  echo "项目更新下载失败：$url" >&2
  return 1
}

read_current_version() {
  if [ -f "$VERSION_FILE" ]; then
    sed -n '1p' "$VERSION_FILE" 2>/dev/null || true
    return
  fi
  if [ -f "$APP_VERSION_FILE" ]; then
    sed -n '1p' "$APP_VERSION_FILE" 2>/dev/null || true
    return
  fi
  if [ -d "$INSTALL_DIR/.git" ] && command -v git >/dev/null 2>&1; then
    git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true
  fi
}

read_remote_version() {
  out="$1"
  download "$REMOTE_SHA_URL" "$out" || return 1
  python3 - "$out" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(data.get("sha", ""))
PY
}

archive_version() {
  archive="$1"
  top="$(tar -tzf "$archive" 2>/dev/null | sed -n '1p' | cut -d/ -f1)"
  case "$top" in
    *-*)
      printf "%s\n" "${top##*-}"
      ;;
    *)
      printf "%s\n" "$top"
      ;;
  esac
}

ensure_downloader
tmp="$(mktemp -d /tmp/bypassproxy-update.XXXXXX)"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

remote_json="$tmp/remote.json"
archive="$tmp/source.tar.gz"
remote_version=""
if remote_version="$(read_remote_version "$remote_json" 2>/dev/null)"; then
  remote_version="$(printf "%s" "$remote_version" | sed -n '1p')"
else
  echo "WARN 无法通过 GitHub API 获取远端版本，将改用源码包判断。" >&2
fi
current_version="$(read_current_version)"

if [ -z "$remote_version" ]; then
  download "$ARCHIVE_URL" "$archive"
  remote_version="$(archive_version "$archive")"
fi

if [ -z "$remote_version" ]; then
  echo "无法获取远端版本号，停止更新。" >&2
  exit 1
fi

if [ -n "$current_version" ] && [ "$current_version" = "$remote_version" ]; then
  echo "已经是最新版本：${current_version}" >&2
  exit 0
fi

if [ -n "$current_version" ]; then
  echo "发现新版本：" >&2
  echo "  当前：$current_version" >&2
  echo "  远端：$remote_version" >&2
else
  echo "当前没有版本记录，将安装远端版本：$remote_version" >&2
fi

if [ ! -s "$archive" ]; then
  download "$ARCHIVE_URL" "$archive"
fi
tar -xzf "$archive" -C "$tmp"
src="$(find "$tmp" -mindepth 2 -maxdepth 2 -type f -name install.sh -exec dirname {} \; | head -n 1)"
if [ -z "$src" ]; then
  echo "下载的项目结构不符合预期。" >&2
  exit 1
fi

backup="${INSTALL_DIR}.bak.$(date +%Y%m%d-%H%M%S)"
if [ -d "$INSTALL_DIR" ]; then
  cp -a "$INSTALL_DIR" "$backup"
  echo "已备份旧安装器：$backup" >&2
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -R "$src/." "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/install.sh" "$INSTALL_DIR"/scripts/*.sh "$INSTALL_DIR"/scripts/*.py 2>/dev/null || true
printf "%s\n" "$remote_version" > "$VERSION_FILE"
mkdir -p "$APP_DIR"
printf "%s\n" "$remote_version" > "$APP_VERSION_FILE"

echo "项目脚本已更新到：$INSTALL_DIR" >&2
echo "正在保留现有配置并重新应用..." >&2
cd "$INSTALL_DIR"
ROUTER_CONF="$CONF" ./install.sh
