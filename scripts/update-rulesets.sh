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
FORCE_RULESET_UPDATE="${FORCE_RULESET_UPDATE:-0}"

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

metadata_once() {
  real_url="$1"
  out="$2"
  tmp="${out}.headers"
  rm -f "$tmp"
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$DOWNLOAD_PROXY" ]; then
      curl -fsSLI --connect-timeout 15 -x "$DOWNLOAD_PROXY" -o "$tmp" "$real_url" || return 1
    else
      curl -fsSLI --connect-timeout 15 -o "$tmp" "$real_url" || return 1
    fi
  else
    return 1
  fi
  awk '
    BEGIN { IGNORECASE = 1 }
    /^etag:/ { sub(/\r$/, ""); print; found = 1 }
    /^last-modified:/ { sub(/\r$/, ""); print; found = 1 }
    END { if (!found) exit 1 }
  ' "$tmp" > "$out"
}

metadata() {
  url="$1"
  out="$2"
  for real_url in $(download_urls "$url"); do
    if metadata_once "$real_url" "$out"; then
      return 0
    fi
  done
  return 1
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

update_rule() {
  name="$1"
  url="$2"
  target="$RULE_DIR/${name}.srs"
  version="$RULE_DIR/${name}.version"
  remote_version="$RULE_DIR/${name}.remote-version"

  if [ "$FORCE_RULESET_UPDATE" != "1" ] && [ -s "$target" ] && [ -f "$version" ]; then
    if metadata "$url" "$remote_version" && cmp -s "$version" "$remote_version"; then
      echo "${name} 已是最新。"
      rm -f "$remote_version"
      return 0
    fi
  fi

  download "$url" "$target"
  if [ -s "$remote_version" ]; then
    mv "$remote_version" "$version"
  elif metadata "$url" "$version" 2>/dev/null; then
    :
  else
    date -u +"updated-at: %Y-%m-%dT%H:%M:%SZ" > "$version"
  fi
  echo "${name} 已更新。"
}

mkdir -p "$RULE_DIR"
update_rule geosite-cn "$GEOSITE_CN_URL"
update_rule geoip-cn "$GEOIP_CN_URL"
echo "国内分流规则检查完成：$RULE_DIR"
