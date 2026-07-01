#!/bin/sh
set -eu

REPO="${REPO:-samsamsue/home_singbox_router}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/home-router-singbox-installer}"
ARCHIVE_URL="${ARCHIVE_URL:-https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz}"
REMOTE_SHA_URL="${REMOTE_SHA_URL:-https://api.github.com/repos/${REPO}/commits/${BRANCH}}"
DOWNLOAD_PROXY="${DOWNLOAD_PROXY:-}"
GITHUB_DOWNLOAD_PREFIX="${GITHUB_DOWNLOAD_PREFIX:-}"
GITHUB_DOWNLOAD_PREFIXES="${GITHUB_DOWNLOAD_PREFIXES:-https://gh-proxy.com/ https://ghproxy.net/ https://gh.llkk.cc/}"

if [ "$(id -u)" != "0" ]; then
  echo "请用 root 运行：" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/bootstrap.sh | sudo sh" >&2
  exit 1
fi

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

download() {
  url="$1"
  out="$2"
  urls="$url"
  case "$url" in
    https://github.com/*|https://raw.githubusercontent.com/*)
      if [ -n "$GITHUB_DOWNLOAD_PREFIX" ]; then
        urls="${GITHUB_DOWNLOAD_PREFIX}${url}"
      else
        for prefix in $GITHUB_DOWNLOAD_PREFIXES; do
          urls="$urls ${prefix}${url}"
        done
      fi
      ;;
  esac
  for try_url in $urls; do
    if download_once "$try_url" "$out"; then
      return 0
    fi
    echo "下载失败，尝试下一个地址：$try_url" >&2
  done
  echo "下载失败：$url" >&2
  return 1
}

download_once() {
  url="$1"
  out="$2"
  partial="${out}.part"
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$DOWNLOAD_PROXY" ]; then
      curl -fL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 --speed-limit 10240 --speed-time 30 -C - -x "$DOWNLOAD_PROXY" -o "$partial" "$url"
    else
      curl -fL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 --speed-limit 10240 --speed-time 30 -C - -o "$partial" "$url"
    fi
  else
    if [ -n "$DOWNLOAD_PROXY" ]; then
      HTTPS_PROXY="$DOWNLOAD_PROXY" HTTP_PROXY="$DOWNLOAD_PROXY" wget -c -O "$partial" "$url"
    else
      wget -c -O "$partial" "$url"
    fi
  fi
  mv "$partial" "$out"
}

ensure_downloader
tmp="$(mktemp -d /tmp/home-router-bootstrap.XXXXXX)"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

archive="$tmp/source.tar.gz"
download "$ARCHIVE_URL" "$archive"
remote_json="$tmp/remote.json"
remote_version=""
if download "$REMOTE_SHA_URL" "$remote_json"; then
  remote_version="$(python3 - "$remote_json" <<'PY' 2>/dev/null || true
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(data.get("sha", ""))
PY
)"
fi
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "$archive" -C "$tmp"
src="$(find "$tmp" -mindepth 2 -maxdepth 2 -type f -name install.sh -exec dirname {} \; | head -n 1)"
if [ -z "$src" ]; then
  echo "下载的安装包结构不符合预期。" >&2
  exit 1
fi
cp -R "$src/." "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/install.sh" "$INSTALL_DIR"/scripts/*.sh 2>/dev/null || true
if [ -n "$remote_version" ]; then
  printf "%s\n" "$remote_version" > "$INSTALL_DIR/.home-router-version"
fi

echo "安装器已下载到 $INSTALL_DIR"
cd "$INSTALL_DIR"
exec ./install.sh
