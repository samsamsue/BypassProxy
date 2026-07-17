#!/bin/sh
set -eu

CONF="${ROUTER_CONF:-/etc/bypassproxy/router.conf}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bypassproxy}"

if [ "$(id -u)" != "0" ]; then
  echo "请用 root 运行：sudo bypassproxy-backup-sync.sh" >&2
  exit 1
fi

if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

SYNC_PROVIDER="${SYNC_PROVIDER:-webdav}"
WEBDAV_URL="${WEBDAV_URL:-}"
WEBDAV_USERNAME="${WEBDAV_USERNAME:-}"
WEBDAV_PASSWORD="${WEBDAV_PASSWORD:-}"
WEBDAV_PATH="${WEBDAV_PATH:-BypassProxy}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_REGION="${S3_REGION:-auto}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${S3_SECRET_KEY:-}"
S3_PREFIX="${S3_PREFIX:-BypassProxy}"
S3_ADDRESSING_STYLE="${S3_ADDRESSING_STYLE:-auto}"

SYNC_PROVIDER="${BYPASSPROXY_SYNC_PROVIDER:-$SYNC_PROVIDER}"
WEBDAV_URL="${BYPASSPROXY_WEBDAV_URL:-$WEBDAV_URL}"
WEBDAV_USERNAME="${BYPASSPROXY_WEBDAV_USERNAME:-$WEBDAV_USERNAME}"
WEBDAV_PASSWORD="${BYPASSPROXY_WEBDAV_PASSWORD:-$WEBDAV_PASSWORD}"
WEBDAV_PATH="${BYPASSPROXY_WEBDAV_PATH:-$WEBDAV_PATH}"
S3_ENDPOINT="${BYPASSPROXY_S3_ENDPOINT:-$S3_ENDPOINT}"
S3_BUCKET="${BYPASSPROXY_S3_BUCKET:-$S3_BUCKET}"
S3_REGION="${BYPASSPROXY_S3_REGION:-$S3_REGION}"
S3_ACCESS_KEY="${BYPASSPROXY_S3_ACCESS_KEY:-$S3_ACCESS_KEY}"
S3_SECRET_KEY="${BYPASSPROXY_S3_SECRET_KEY:-$S3_SECRET_KEY}"
S3_PREFIX="${BYPASSPROXY_S3_PREFIX:-$S3_PREFIX}"
S3_ADDRESSING_STYLE="${BYPASSPROXY_S3_ADDRESSING_STYLE:-$S3_ADDRESSING_STYLE}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令：$1" >&2
    exit 1
  fi
}

timestamp() {
  date +%Y%m%d-%H%M%S
}

backup_name() {
  printf "bypassproxy-backup-%s.tar.gz" "$(timestamp)"
}

create_manifest() {
  list="$1"
  : > "$list"
  for path in \
    /etc/bypassproxy/router.conf \
    /etc/bypassproxy/custom-rules.json \
    /etc/bypassproxy/outbounds.json \
    /etc/bypassproxy/subscriptions.d \
    /etc/bypassproxy/subscription-cache.d \
    /etc/bypassproxy/rules \
    /etc/sing-box/config.json
  do
    if [ -e "$path" ] || [ -L "$path" ]; then
      printf "%s\n" "${path#/}" >> "$list"
    fi
  done
}

create_backup() {
  need_cmd tar
  mkdir -p "$BACKUP_DIR"
  backup="${BACKUP_DIR}/$(backup_name)"
  create_backup_file "$backup"
  echo "$backup"
}

create_backup_file() {
  need_cmd tar
  backup="$1"
  mkdir -p "$(dirname "$backup")"
  list="$(mktemp /tmp/bypassproxy-backup-list.XXXXXX)"
  create_manifest "$list"
  if [ ! -s "$list" ]; then
    rm -f "$list"
    echo "没有可备份的配置文件。" >&2
    exit 1
  fi
  tar -C / -czf "$backup" -T "$list"
  rm -f "$list"
  chmod 0600 "$backup" 2>/dev/null || true
}

webdav_base_url() {
  base="$(printf "%s" "$WEBDAV_URL" | sed 's#/*$##')"
  path="$(printf "%s" "$WEBDAV_PATH" | sed 's#^/*##; s#/*$##')"
  if [ -n "$path" ]; then
    printf "%s/%s" "$base" "$path"
  else
    printf "%s" "$base"
  fi
}

ensure_webdav() {
  need_cmd curl
  if [ "$SYNC_PROVIDER" != "webdav" ]; then
    echo "当前只支持 WebDAV 同步。" >&2
    exit 1
  fi
  if [ -z "$WEBDAV_URL" ] || [ -z "$WEBDAV_USERNAME" ] || [ -z "$WEBDAV_PASSWORD" ]; then
    echo "请先配置 WEBDAV_URL / WEBDAV_USERNAME / WEBDAV_PASSWORD。" >&2
    exit 1
  fi
}

webdav_mkcol() {
  url="$1"
  curl -fsS -u "${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}" -X MKCOL "$url" >/dev/null 2>&1 || true
}

webdav_upload() {
  ensure_webdav
  file="${1:-}"
  temp_file=""
  if [ -z "$file" ]; then
    temp_file="/tmp/$(backup_name)"
    echo "创建临时备份：$temp_file"
    create_backup_file "$temp_file"
    file="$temp_file"
  fi
  if [ ! -f "$file" ]; then
    echo "备份文件不存在：$file" >&2
    exit 1
  fi
  base="$(webdav_base_url)"
  webdav_mkcol "$base"
  name="$(basename "$file")"
  echo "上传备份：$name"
  if ! curl -fS -u "${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}" -T "$file" "${base}/${name}"; then
    [ -z "$temp_file" ] || rm -f "$temp_file"
    echo "上传失败。" >&2
    exit 1
  fi
  echo
  echo "已上传到：${base}/${name}"
  if [ -n "$temp_file" ]; then
    rm -f "$temp_file"
    echo "已清理临时备份。"
  fi
}

webdav_test() {
  ensure_webdav
  base="$(webdav_base_url)"
  webdav_mkcol "$base"
  tmp="$(mktemp /tmp/bypassproxy-webdav-test.XXXXXX)"
  name=".bypassproxy-test-$(timestamp).txt"
  printf "BypassProxy WebDAV test %s\n" "$(date)" > "$tmp"
  echo "测试 WebDAV 目录：$base"
  echo "上传测试文件：$name"
  curl -fS -u "${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}" -T "$tmp" "${base}/${name}"
  echo
  echo "删除测试文件：$name"
  curl -fS -u "${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}" -X DELETE "${base}/${name}" >/dev/null
  rm -f "$tmp"
  echo "WebDAV 连接和写入权限正常。"
}

webdav_list() {
  ensure_webdav
  need_cmd python3
  base="$(webdav_base_url)"
  xml="$(mktemp /tmp/bypassproxy-webdav-list.XXXXXX)"
  curl -fsS -u "${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}" -X PROPFIND -H "Depth: 1" -o "$xml" "$base/"
  python3 - "$xml" <<'PY'
import re
import sys
from html import unescape
from urllib.parse import unquote

with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
    body = f.read()
names = []
for href in re.findall(r"<[^>]*href[^>]*>(.*?)</[^>]*href>", body, flags=re.I | re.S):
    name = unquote(unescape(href.strip()).rstrip("/").split("/")[-1])
    if name.startswith("bypassproxy-backup-") and name.endswith(".tar.gz"):
        names.append(name)
for name in sorted(set(names)):
    print(name)
PY
  rm -f "$xml"
}

webdav_latest_name() {
  latest="$(webdav_list | tail -n 1)"
  if [ -z "$latest" ]; then
    echo "远端没有找到 BypassProxy 备份。" >&2
    exit 1
  fi
  printf "%s" "$latest"
}

webdav_download_latest() {
  ensure_webdav
  mkdir -p "$BACKUP_DIR"
  name="$(webdav_latest_name)"
  out="${BACKUP_DIR}/${name}"
  echo "下载最新备份：$name"
  curl -fS -u "${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}" -o "$out" "$(webdav_base_url)/${name}"
  chmod 0600 "$out" 2>/dev/null || true
  echo "$out"
}

s3_key() {
  name="$1"
  prefix="$(printf "%s" "$S3_PREFIX" | sed 's#^/*##; s#/*$##')"
  if [ -n "$prefix" ]; then
    printf "%s/%s" "$prefix" "$name"
  else
    printf "%s" "$name"
  fi
}

ensure_s3() {
  need_cmd python3
  if [ "$SYNC_PROVIDER" != "s3" ]; then
    echo "当前同步方式不是 S3。" >&2
    exit 1
  fi
  if [ -z "$S3_BUCKET" ] || [ -z "$S3_REGION" ] || [ -z "$S3_ACCESS_KEY" ] || [ -z "$S3_SECRET_KEY" ]; then
    echo "请先配置 S3_BUCKET / S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY。" >&2
    exit 1
  fi
  if [ -z "$S3_ENDPOINT" ] && [ "$S3_REGION" = "auto" ]; then
    echo "S3 Endpoint 留空时按 AWS S3 处理，请把 S3_REGION 填成真实区域，例如 us-east-1。" >&2
    exit 1
  fi
}

s3_request() {
  op="$1"
  key="${2:-}"
  file="${3:-}"
  ensure_s3
  S3_OP="$op" S3_KEY="$key" S3_FILE="$file" \
  S3_ENDPOINT="$S3_ENDPOINT" S3_BUCKET="$S3_BUCKET" S3_REGION="$S3_REGION" \
  S3_ACCESS_KEY="$S3_ACCESS_KEY" S3_SECRET_KEY="$S3_SECRET_KEY" S3_PREFIX="$S3_PREFIX" \
  S3_ADDRESSING_STYLE="$S3_ADDRESSING_STYLE" \
  python3 - <<'PY'
import datetime
import hashlib
import hmac
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

endpoint_from_config = os.environ.get("S3_ENDPOINT", "").strip().rstrip("/")
bucket = os.environ["S3_BUCKET"]
region = os.environ.get("S3_REGION") or "auto"
access_key = os.environ["S3_ACCESS_KEY"]
secret_key = os.environ["S3_SECRET_KEY"]
prefix = os.environ.get("S3_PREFIX", "").strip("/")
addressing_style = os.environ.get("S3_ADDRESSING_STYLE", "auto").strip().lower() or "auto"
op = os.environ["S3_OP"]
key = os.environ.get("S3_KEY", "").lstrip("/")
file_path = os.environ.get("S3_FILE", "")

aws_endpoint = not endpoint_from_config
endpoint = endpoint_from_config or f"https://s3.{region}.amazonaws.com"
parsed = urllib.parse.urlparse(endpoint)
if parsed.scheme not in {"http", "https"} or not parsed.netloc:
    raise SystemExit("S3 Endpoint 格式无效")
if addressing_style not in {"auto", "path", "virtual"}:
    raise SystemExit("S3 地址模式无效，请使用 auto / path / virtual")

def quote_path(value: str) -> str:
    return urllib.parse.quote(value, safe="/-_.~")

def sign(key_bytes: bytes, msg: str) -> bytes:
    return hmac.new(key_bytes, msg.encode("utf-8"), hashlib.sha256).digest()

def signing_key() -> bytes:
    date = datetime.datetime.now(datetime.UTC).strftime("%Y%m%d")
    k_date = sign(("AWS4" + secret_key).encode("utf-8"), date)
    k_region = sign(k_date, region)
    k_service = sign(k_region, "s3")
    return sign(k_service, "aws4_request")

def is_dns_bucket(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,61}[a-z0-9]", value)) and ".." not in value and ".-" not in value and "-." not in value

def candidate_styles() -> list[str]:
    if aws_endpoint:
        return ["virtual"]
    if addressing_style == "path":
        return ["path"]
    if addressing_style == "virtual":
        return ["virtual"]
    styles = ["path"]
    if is_dns_bucket(bucket):
        styles.append("virtual")
    return styles

class S3RequestError(Exception):
    def __init__(self, style: str, message: str):
        super().__init__(message)
        self.style = style
        self.message = message

def request_once(style: str, method: str, object_key: str = "", query: dict[str, str] | None = None, body: bytes = b"") -> bytes:
    now = datetime.datetime.now(datetime.UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    query = query or {}
    canonical_query = "&".join(
        f"{urllib.parse.quote(str(k), safe='-_.~')}={urllib.parse.quote(str(v), safe='-_.~')}"
        for k, v in sorted(query.items())
    )
    path_key = quote_path(object_key)
    if style == "virtual":
        canonical_uri = f"/{path_key}" if path_key else "/"
        host = f"{bucket}.{parsed.netloc}"
    else:
        canonical_uri = f"/{bucket}" + (f"/{path_key}" if path_key else "")
        host = parsed.netloc
    url = urllib.parse.urlunparse((parsed.scheme, host, canonical_uri, "", canonical_query, ""))
    payload_hash = hashlib.sha256(body).hexdigest()
    headers = {
        "accept": "*/*",
        "host": host,
        "user-agent": "BypassProxy/1.0 S3Compatible",
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if body:
        headers["content-length"] = str(len(body))
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{name}:{headers[name]}\n" for name in sorted(headers))
    canonical_request = "\n".join([method, canonical_uri, canonical_query, canonical_headers, signed_headers, payload_hash])
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, credential_scope, hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()])
    signature = hmac.new(signing_key(), string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    headers["Authorization"] = f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    req = urllib.request.Request(url, data=body if method in {"PUT", "POST"} else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            print(f"S3 请求成功：{style}-style", file=sys.stderr)
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        compact = " ".join(detail.split())
        if len(compact) > 500:
            compact = compact[:500] + "..."
        raise S3RequestError(style, f"HTTP {exc.code}: {compact or exc.reason}")
    except urllib.error.URLError as exc:
        raise S3RequestError(style, str(exc.reason))

def request(method: str, object_key: str = "", query: dict[str, str] | None = None, body: bytes = b"") -> bytes:
    errors = []
    for style in candidate_styles():
        try:
            return request_once(style, method, object_key, query, body)
        except S3RequestError as exc:
            errors.append(f"{exc.style}-style: {exc.message}")
    hint = ""
    if any("1010" in item for item in errors):
        hint = "\n提示：HTTP 403 / 1010 通常是 Endpoint 前面的 CDN/WAF 拦截了 S3 API 请求。请确认 Endpoint 是服务商提供的 S3 API 地址，不是网页/CDN/公开访问域名。"
    raise SystemExit("S3 请求失败：\n- " + "\n- ".join(errors) + hint)

def full_key(name: str) -> str:
    name = name.lstrip("/")
    return f"{prefix}/{name}" if prefix else name

if op == "put":
    with open(file_path, "rb") as f:
        body = f.read()
    request("PUT", full_key(key), body=body)
elif op == "delete":
    request("DELETE", full_key(key))
elif op == "get":
    data = request("GET", full_key(key))
    with open(file_path, "wb") as f:
        f.write(data)
elif op == "list":
    query = {"list-type": "2", "prefix": (prefix + "/" if prefix else "")}
    data = request("GET", "", query=query)
    root = ET.fromstring(data)
    names = []
    for item in root.findall(".//{*}Key"):
        value = item.text or ""
        name = value.rsplit("/", 1)[-1]
        if name.startswith("bypassproxy-backup-") and name.endswith(".tar.gz"):
            names.append(name)
    for name in sorted(set(names)):
        print(name)
else:
    raise SystemExit(f"未知 S3 操作：{op}")
PY
}

s3_test() {
  ensure_s3
  tmp="$(mktemp /tmp/bypassproxy-s3-test.XXXXXX)"
  name=".bypassproxy-test-$(timestamp).txt"
  printf "BypassProxy S3 test %s\n" "$(date)" > "$tmp"
  if [ -n "$S3_ENDPOINT" ]; then
    echo "测试 S3：${S3_ENDPOINT}/${S3_BUCKET}/$(s3_key "$name")"
  else
    echo "测试 AWS S3：s3://${S3_BUCKET}/$(s3_key "$name")（Region: $S3_REGION）"
  fi
  echo "上传测试文件：$name"
  s3_request put "$name" "$tmp"
  echo "删除测试文件：$name"
  s3_request delete "$name"
  rm -f "$tmp"
  echo "S3 连接和写入权限正常。"
}

s3_upload() {
  ensure_s3
  file="${1:-}"
  temp_file=""
  if [ -z "$file" ]; then
    temp_file="/tmp/$(backup_name)"
    echo "创建临时备份：$temp_file"
    create_backup_file "$temp_file"
    file="$temp_file"
  fi
  if [ ! -f "$file" ]; then
    echo "备份文件不存在：$file" >&2
    exit 1
  fi
  name="$(basename "$file")"
  echo "上传备份：$name"
  if ! s3_request put "$name" "$file"; then
    [ -z "$temp_file" ] || rm -f "$temp_file"
    echo "上传失败。" >&2
    exit 1
  fi
  echo "已上传到：s3://${S3_BUCKET}/$(s3_key "$name")"
  if [ -n "$temp_file" ]; then
    rm -f "$temp_file"
    echo "已清理临时备份。"
  fi
}

s3_list() {
  ensure_s3
  s3_request list
}

s3_latest_name() {
  latest="$(s3_list | tail -n 1)"
  if [ -z "$latest" ]; then
    echo "远端没有找到 BypassProxy 备份。" >&2
    exit 1
  fi
  printf "%s" "$latest"
}

s3_download_latest() {
  ensure_s3
  mkdir -p "$BACKUP_DIR"
  name="$(s3_latest_name)"
  out="${BACKUP_DIR}/${name}"
  echo "下载最新备份：$name"
  s3_request get "$name" "$out"
  chmod 0600 "$out" 2>/dev/null || true
  echo "$out"
}

sync_test() {
  if [ "$SYNC_PROVIDER" = "s3" ]; then
    s3_test
  else
    webdav_test
  fi
}

sync_upload() {
  if [ "$SYNC_PROVIDER" = "s3" ]; then
    s3_upload "${1:-}"
  else
    webdav_upload "${1:-}"
  fi
}

sync_list() {
  if [ "$SYNC_PROVIDER" = "s3" ]; then
    s3_list
  else
    webdav_list
  fi
}

sync_download_latest() {
  if [ "$SYNC_PROVIDER" = "s3" ]; then
    s3_download_latest
  else
    webdav_download_latest
  fi
}

restore_backup() {
  need_cmd tar
  file="$1"
  if [ ! -f "$file" ]; then
    echo "备份文件不存在：$file" >&2
    exit 1
  fi
  snapshot="$(create_backup)"
  echo "恢复前快照：$snapshot"
  tar -C / -xzf "$file"
  echo "已恢复：$file"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart sing-box 2>/dev/null || true
    if [ "${BYPASSPROXY_SKIP_ADMIN_RESTART:-0}" != "1" ]; then
      systemctl restart bypassproxy-admin 2>/dev/null || true
    fi
    systemctl restart bypassproxy-forward.timer 2>/dev/null || true
  fi
  if [ -x /usr/local/sbin/bypassproxy-forward.sh ]; then
    ROUTER_CONF="$CONF" /usr/local/sbin/bypassproxy-forward.sh 2>/dev/null || true
  fi
}

usage() {
  cat <<EOF
用法：
  bypassproxy-backup-sync.sh backup
  bypassproxy-backup-sync.sh test
  bypassproxy-backup-sync.sh upload [备份文件]
  bypassproxy-backup-sync.sh list
  bypassproxy-backup-sync.sh restore-latest
  bypassproxy-backup-sync.sh restore <备份文件>
EOF
}

case "${1:-}" in
  backup)
    create_backup
    ;;
  test)
    sync_test
    ;;
  upload)
    sync_upload "${2:-}"
    ;;
  list)
    sync_list
    ;;
  restore-latest)
    file="$(sync_download_latest)"
    restore_backup "$file"
    ;;
  restore)
    if [ -z "${2:-}" ]; then
      usage >&2
      exit 1
    fi
    restore_backup "$2"
    ;;
  *)
    usage
    exit 1
    ;;
esac
