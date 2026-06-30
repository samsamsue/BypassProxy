#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/home-router-singbox/router.conf}"
RULE_DIR="${RULE_DIR:-/etc/home-router-singbox/rules}"

if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

DOWNLOAD_PROXY="${DOWNLOAD_PROXY:-}"
GITHUB_DOWNLOAD_PREFIX="${GITHUB_DOWNLOAD_PREFIX:-}"
GITHUB_DOWNLOAD_PREFIXES="${GITHUB_DOWNLOAD_PREFIXES:-https://gh-proxy.com/ https://ghproxy.net/ https://gh.llkk.cc/}"
GEOIP_CN_URL="${GEOIP_CN_URL:-https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs}"
GEOSITE_CN_URL="${GEOSITE_CN_URL:-https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs}"

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
  real_url="$1"
  out="$2"
  partial="${out}.part"
  rm -f "$partial"
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$DOWNLOAD_PROXY" ]; then
      curl -fL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 --speed-limit 10240 --speed-time 30 -x "$DOWNLOAD_PROXY" -o "$partial" "$real_url" || return 1
    else
      curl -fL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 --speed-limit 10240 --speed-time 30 -o "$partial" "$real_url" || return 1
    fi
  else
    wget -O "$partial" "$real_url" || return 1
  fi
  [ -s "$partial" ] || return 1
  mv "$partial" "$out"
}

download() {
  url="$1"
  out="$2"
  echo "正在下载分流规则：$url" >&2
  for real_url in $(download_urls "$url"); do
    if download_once "$real_url" "$out"; then
      return 0
    fi
    echo "下载失败，尝试下一个地址：$real_url" >&2
  done
  echo "分流规则下载失败：$url" >&2
  return 1
}

mkdir -p "$RULE_DIR"
download "$GEOSITE_CN_URL" "$RULE_DIR/geosite-cn.srs"
download "$GEOIP_CN_URL" "$RULE_DIR/geoip-cn.srs"
echo "国内分流规则已更新：$RULE_DIR"
