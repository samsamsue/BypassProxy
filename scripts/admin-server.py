#!/usr/bin/env python3
import json
import os
import re
import selectors
import shlex
import signal
import subprocess
import time
import ipaddress
from concurrent.futures import ThreadPoolExecutor, as_completed
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen


CONF = Path(os.environ.get("ROUTER_CONF", "/etc/bypassproxy/router.conf"))
APP_DIR = Path(os.environ.get("APP_DIR", "/opt/bypassproxy"))
SUBSCRIPTION_DIR = Path(os.environ.get("SUBSCRIPTION_DIR", "/etc/bypassproxy/subscriptions.d"))
SUBSCRIPTION_INFO = Path(os.environ.get("SUBSCRIPTION_INFO", "/etc/bypassproxy/subscription-cache.d/subscription-info.json"))
OUTBOUNDS_JSON = Path(os.environ.get("OUTBOUNDS_JSON", "/etc/bypassproxy/outbounds.json"))
SING_BOX_CONFIG = Path(os.environ.get("SING_BOX_CONFIG", "/etc/sing-box/config.json"))
MIHOMO_CONFIG = Path(os.environ.get("MIHOMO_CONFIG", "/etc/mihomo/config.yaml"))
CUSTOM_RULES_JSON = Path(os.environ.get("CUSTOM_RULES_JSON", "/etc/bypassproxy/custom-rules.json"))
STATIC_DIR = Path(os.environ.get("ADMIN_UI_DIR", "/usr/local/share/bypassproxy-admin"))


def parse_conf_value(value: str) -> str:
    try:
        parts = shlex.split(value, comments=False, posix=True)
    except ValueError:
        return value
    if len(parts) == 1:
        return parts[0]
    return value


def read_conf() -> dict[str, str]:
    values = {}
    if CONF.exists():
        for raw in CONF.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = parse_conf_value(value.strip())
    defaults = {
        "LAN_IP": "192.168.3.88",
        "PROXY_PORT": "7890",
        "PANEL_PORT": "9091",
        "PANEL_SECRET": "abc123",
        "ADMIN_PORT": "8088",
    }
    defaults.update(values)
    return defaults


def current_kernel() -> str:
    return "mihomo" if read_conf().get("KERNEL", "sing-box").strip().lower() == "mihomo" else "sing-box"


def kernel_service() -> str:
    return "mihomo" if current_kernel() == "mihomo" else "sing-box"


def kernel_config_command() -> list[str]:
    return ["mihomo", "-t", "-f", str(MIHOMO_CONFIG)] if current_kernel() == "mihomo" else ["sing-box", "check", "-C", "/etc/sing-box"]


def kernel_render_command() -> tuple[list[str], dict[str, str]]:
    if current_kernel() == "mihomo":
        return (["/usr/local/sbin/bypassproxy-kernel.sh", "render"], {"ROUTER_CONF": str(CONF), "APP_DIR": str(APP_DIR), "OUTBOUNDS_JSON": str(OUTBOUNDS_JSON)})
    return (["python3", str(APP_DIR / "scripts/render-config.py")], {"ROUTER_CONF": str(CONF), "OUTBOUNDS_JSON": str(OUTBOUNDS_JSON), "OUTPUT": str(SING_BOX_CONFIG), "CUSTOM_RULES_JSON": str(custom_rules_path())})


def quote_value(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def custom_rules_path() -> Path:
    configured = os.environ.get("CUSTOM_RULES_JSON") or read_conf().get("CUSTOM_RULES_JSON") or str(CUSTOM_RULES_JSON)
    return Path(configured)


def sync_settings() -> dict:
    conf = read_conf()
    return {
        "provider": conf.get("SYNC_PROVIDER", "webdav") or "webdav",
        "webdavUrl": conf.get("WEBDAV_URL", ""),
        "webdavUsername": conf.get("WEBDAV_USERNAME", ""),
        "webdavPath": conf.get("WEBDAV_PATH", "BypassProxy") or "BypassProxy",
        "hasPassword": bool(conf.get("WEBDAV_PASSWORD", "")),
        "s3Endpoint": conf.get("S3_ENDPOINT", ""),
        "s3Bucket": conf.get("S3_BUCKET", ""),
        "s3Region": conf.get("S3_REGION", "auto") or "auto",
        "s3AccessKey": conf.get("S3_ACCESS_KEY", ""),
        "s3Prefix": conf.get("S3_PREFIX", "BypassProxy") or "BypassProxy",
        "hasS3SecretKey": bool(conf.get("S3_SECRET_KEY", "")),
    }


def save_conf_key(key: str, value: str) -> None:
    CONF.parent.mkdir(parents=True, exist_ok=True)
    lines = CONF.read_text(encoding="utf-8-sig").splitlines() if CONF.exists() else []
    new_line = f"{key}={quote_value(value)}"
    written = False
    result = []
    for line in lines:
        if line.startswith(f"{key}="):
            result.append(new_line)
            written = True
        else:
            result.append(line)
    if not written:
        result.append(new_line)
    CONF.write_text("\n".join(result) + "\n", encoding="utf-8")
    try:
        CONF.chmod(0o600)
    except OSError:
        pass


def cidr_to_network(cidr: str) -> str:
    try:
        return str(ipaddress.ip_interface(cidr).network)
    except ValueError:
        return ""


def is_virtual_or_tunnel_interface(name: str) -> bool:
    prefixes = (
        "br-",
        "docker",
        "dummy",
        "ip6tnl",
        "lo",
        "sit",
        "sbtun",
        "tailscale",
        "tun",
        "veth",
        "virbr",
        "wg",
        "zt",
    )
    return name == "lo" or name.startswith(prefixes)



def empty_custom_rules() -> dict[str, list[str]]:
    return {"directDomains": [], "directIps": [], "proxyDomains": [], "proxyIps": []}


def normalize_custom_domain(value: str) -> str:
    value = str(value or "").strip().lower()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = re.split(r"[/?#]", value, maxsplit=1)[0]
    value = value.split(":", 1)[0]
    value = value.lstrip("*.").strip(".")
    if not value or any(char.isspace() for char in value):
        raise ValueError(f"域名格式无效：{value or '(空)'}")
    return value


def normalize_custom_ip(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        raise ValueError("IP/CIDR 不能为空")
    try:
        return str(ipaddress.ip_network(value, strict=False))
    except ValueError as exc:
        raise ValueError(f"IP/CIDR 格式无效：{value}") from exc


def normalize_custom_rules(data: dict) -> dict[str, list[str]]:
    rules = empty_custom_rules()
    aliases = {
        "directDomains": ["directDomains", "direct_domains"],
        "directIps": ["directIps", "direct_ips"],
        "proxyDomains": ["proxyDomains", "proxy_domains"],
        "proxyIps": ["proxyIps", "proxy_ips"],
    }
    for key, names in aliases.items():
        raw_values = []
        for name in names:
            value = data.get(name)
            if isinstance(value, list):
                raw_values = value
                break
        seen = set()
        for raw in raw_values:
            value = normalize_custom_ip(raw) if key.endswith("Ips") else normalize_custom_domain(raw)
            if value not in seen:
                seen.add(value)
                rules[key].append(value)
    return rules


def load_custom_rules() -> dict[str, list[str]]:
    path = custom_rules_path()
    if not path.exists():
        return empty_custom_rules()
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("自定义分流规则必须是 JSON 对象")
    return normalize_custom_rules(data)


def save_custom_rules(data: dict) -> dict[str, list[str]]:
    rules = normalize_custom_rules(data)
    path = custom_rules_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return rules


def list_network_interfaces() -> list[dict[str, str]]:
    result = run_command(["ip", "-4", "-o", "addr", "show"], timeout=8)
    if not result["ok"]:
        return []
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for line in result["stdout"].splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        name = parts[1]
        cidr = parts[3]
        if is_virtual_or_tunnel_interface(name):
            continue
        address = cidr.split("/", 1)[0]
        network = cidr_to_network(cidr)
        key = f"{name}:{cidr}"
        if key in seen:
            continue
        seen.add(key)
        items.append({"name": name, "address": address, "cidr": cidr, "network": network})
    return items


def detect_lan_settings(preferred_if: str = "") -> dict[str, str]:
    interfaces = list_network_interfaces()
    chosen = None
    if preferred_if:
        chosen = next((item for item in interfaces if item["name"] == preferred_if), None)
    if chosen is None:
        route = run_command(["ip", "route", "show", "default"], timeout=8)
        default_if = ""
        if route["ok"]:
            match = re.search(r"\bdev\s+(\S+)", route["stdout"])
            if match:
                default_if = match.group(1)
        if default_if:
            chosen = next((item for item in interfaces if item["name"] == default_if), None)
    if chosen is None and interfaces:
        chosen = interfaces[0]
    return {
        "LAN_IF": chosen["name"] if chosen else "",
        "LAN_IP": chosen["address"] if chosen else "",
        "LAN_NET": chosen["network"] if chosen else "",
    }


def run_command(args: list[str], timeout: int = 120, env: dict[str, str] | None = None) -> dict:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    try:
        completed = subprocess.run(
            args,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            env=merged_env,
        )
        return {
            "ok": completed.returncode == 0,
            "code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "output": (completed.stdout + completed.stderr).strip(),
        }
    except FileNotFoundError as exc:
        return {"ok": False, "code": 127, "stdout": "", "stderr": str(exc), "output": str(exc)}
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        return {"ok": False, "code": 124, "stdout": stdout, "stderr": stderr, "output": f"{stdout}{stderr}\n命令超时".strip()}


def action_steps(action: str, data: dict) -> list[tuple[str, list[str], int, dict[str, str] | None]]:
    router_env = {"ROUTER_CONF": str(CONF)}
    render_cmd, render_env = kernel_render_command()
    def sync_env_from_data() -> dict[str, str]:
        env = dict(router_env)
        mapping = {
            "provider": "BYPASSPROXY_SYNC_PROVIDER",
            "webdavUrl": "BYPASSPROXY_WEBDAV_URL",
            "webdavUsername": "BYPASSPROXY_WEBDAV_USERNAME",
            "webdavPassword": "BYPASSPROXY_WEBDAV_PASSWORD",
            "webdavPath": "BYPASSPROXY_WEBDAV_PATH",
            "s3Endpoint": "BYPASSPROXY_S3_ENDPOINT",
            "s3Bucket": "BYPASSPROXY_S3_BUCKET",
            "s3Region": "BYPASSPROXY_S3_REGION",
            "s3AccessKey": "BYPASSPROXY_S3_ACCESS_KEY",
            "s3SecretKey": "BYPASSPROXY_S3_SECRET_KEY",
            "s3Prefix": "BYPASSPROXY_S3_PREFIX",
        }
        for source, target in mapping.items():
            value = str(data.get(source) or "").strip()
            if value:
                env[target] = value
        return env
    if action == "update-subscription":
        sub_env = dict(router_env)
        subscription_id = str(data.get("subscriptionId") or "").strip()
        if subscription_id:
            sub_env["BYPASSPROXY_SUBSCRIPTION_ID"] = subscription_id
        if data.get("direct"):
            sub_env["BYPASSPROXY_DIRECT_DOWNLOAD"] = "1"
        return [
            ("更新订阅", ["/usr/local/sbin/bypassproxy-update-subscription.sh"], 240, sub_env),
            ("生成配置", render_cmd, 60, render_env),
            ("检查配置", kernel_config_command(), 60, None),
            ("重启 sing-box", ["systemctl", "restart", kernel_service()], 40, None),
        ]
    if action == "apply-config":
        return [
            ("生成配置", render_cmd, 60, render_env),
            ("检查配置", kernel_config_command(), 60, None),
            ("重启 sing-box", ["systemctl", "restart", kernel_service()], 40, None),
        ]
    if action == "check-config":
        return [("检查配置", kernel_config_command(), 60, None)]
    if action == "check-mihomo":
        return [("check mihomo", ["/usr/local/sbin/bypassproxy-kernel.sh", "check"], 120, {"ROUTER_CONF": str(CONF), "APP_DIR": str(APP_DIR), "OUTBOUNDS_JSON": str(OUTBOUNDS_JSON)})]
    if action == "switch-kernel-sing-box":
        return [("switch to sing-box", ["/usr/local/sbin/bypassproxy-kernel.sh", "switch", "sing-box"], 180, {"ROUTER_CONF": str(CONF), "APP_DIR": str(APP_DIR), "OUTBOUNDS_JSON": str(OUTBOUNDS_JSON)})]
    if action == "switch-kernel-mihomo":
        return [("switch to mihomo", ["/usr/local/sbin/bypassproxy-kernel.sh", "switch", "mihomo"], 300, {"ROUTER_CONF": str(CONF), "APP_DIR": str(APP_DIR), "OUTBOUNDS_JSON": str(OUTBOUNDS_JSON)})]
    if action == "restart-sing-box":
        return [("重启 sing-box", ["systemctl", "restart", kernel_service()], 40, None)]
    if action == "pause-proxy":
        return [("暂停代理服务", ["systemctl", "disable", "--now", kernel_service()], 40, None)]
    if action == "resume-proxy":
        return [
            ("生成配置", render_cmd, 60, render_env),
            ("检查配置", kernel_config_command(), 60, None),
            ("恢复代理服务", ["systemctl", "enable", "--now", kernel_service()], 40, None),
            ("应用转发/NAT", ["/usr/local/sbin/bypassproxy-forward.sh"], 60, router_env),
        ]
    if action in {"enable-tun", "disable-tun"}:
        enabled = action == "enable-tun"
        save_conf_key("TUN_ENABLE", "1" if enabled else "0")
        return [
            ("生成配置", render_cmd, 60, render_env),
            ("检查配置", kernel_config_command(), 60, None),
            ("重启 sing-box", ["systemctl", "restart", kernel_service()], 40, None),
            ("更新转发/NAT", ["/usr/local/sbin/bypassproxy-forward.sh"], 60, router_env),
        ]
    if action == "update-rulesets":
        return [("更新国内分流规则", ["/usr/local/sbin/bypassproxy-update-rulesets.sh"], 180, router_env)]
    if action == "update-webui":
        return [("更新节点面板", ["/usr/local/sbin/bypassproxy-update-webui.sh"], 240, router_env)]
    if action == "update-core":
        return [("更新 BypassProxy 脚本", ["/usr/local/sbin/bypassproxy-update-core.sh"], 360, router_env)]
    if action == "diagnose-network":
        return [("网络诊断", ["/usr/local/sbin/bypassproxy-diagnose-network.sh"], 180, router_env)]
    if action == "test-lan-client":
        return [("旁路由模拟测试", ["/usr/local/sbin/bypassproxy-client-test.sh"], 120, router_env)]
    if action == "speed-test":
        return [("节点下载测速", ["/usr/local/sbin/bypassproxy-speed-test.sh"], 90, router_env)]
    if action == "repair":
        return [("一键修复", ["/usr/local/sbin/bypassproxy-repair.sh"], 300, router_env)]
    if action == "apply-forwarding":
        return [
            ("启用转发定时器", ["systemctl", "enable", "--now", "bypassproxy-forward.timer"], 40, None),
            ("应用转发/NAT", ["/usr/local/sbin/bypassproxy-forward.sh"], 60, router_env),
        ]
    if action == "disable-forwarding":
        return [
            ("停用转发定时器", ["systemctl", "disable", "--now", "bypassproxy-forward.timer"], 40, None),
            ("清理转发/NAT", ["/usr/local/sbin/bypassproxy-forward.sh", "stop"], 60, router_env),
        ]
    if action == "backup-local":
        return [("创建本地备份", ["/usr/local/sbin/bypassproxy-backup-sync.sh", "backup"], 120, router_env)]
    if action == "sync-test":
        return [("测试远程同步连接", ["/usr/local/sbin/bypassproxy-backup-sync.sh", "test"], 120, sync_env_from_data())]
    if action == "sync-upload":
        return [("上传备份到远程同步", ["/usr/local/sbin/bypassproxy-backup-sync.sh", "upload"], 300, router_env)]
    if action == "sync-restore-latest":
        restore_env = dict(router_env)
        restore_env["BYPASSPROXY_SKIP_ADMIN_RESTART"] = "1"
        return [("从远程同步恢复最新备份", ["/usr/local/sbin/bypassproxy-backup-sync.sh", "restore-latest"], 300, restore_env)]
    raise ValueError("接口不存在")


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name != "nt" and hasattr(os, "killpg"):
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.wait(timeout=5)
    except Exception:
        try:
            if os.name != "nt" and hasattr(os, "killpg"):
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except Exception:
            pass


def systemctl_is_active(name: str) -> str:
    result = run_command(["systemctl", "is-active", name], timeout=8)
    if result["code"] == 127:
        return "unknown"
    return (result["stdout"] or result["stderr"]).strip() or "unknown"


def detect_zt_ip() -> str:
    result = run_command(["ip", "-4", "-o", "addr", "show"], timeout=8)
    if not result["ok"]:
        return ""
    for line in result["stdout"].splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[1].startswith("zt"):
            return parts[3].split("/", 1)[0]
    return ""


def load_subscription(path: Path) -> dict[str, str]:
    values = {"NAME": path.stem, "URL": "", "ENABLED": "1"}
    if path.exists():
        for raw in path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = parse_conf_value(value.strip())
    return {
        "id": path.stem,
        "name": values.get("NAME") or path.stem,
        "url": values.get("URL") or "",
        "enabled": values.get("ENABLED", "1") != "0",
    }


def list_subscriptions() -> list[dict]:
    SUBSCRIPTION_DIR.mkdir(parents=True, exist_ok=True)
    try:
        info = json.loads(SUBSCRIPTION_INFO.read_text(encoding="utf-8-sig"))
    except Exception:
        info = {}
    if not isinstance(info, dict):
        info = {}
    items = []
    for path in sorted(SUBSCRIPTION_DIR.glob("*.conf")):
        item = load_subscription(path)
        userinfo = info.get(item["id"])
        if isinstance(userinfo, dict):
            item["userinfo"] = userinfo
        items.append(item)
    return items


def next_subscription_id() -> str:
    current = []
    for item in SUBSCRIPTION_DIR.glob("*.conf"):
        if re.fullmatch(r"\d{3}", item.stem):
            current.append(int(item.stem))
    return f"{(max(current) if current else 0) + 1:03d}"


def subscription_path(sub_id: str) -> Path:
    if not re.fullmatch(r"\d{1,3}", sub_id):
        raise ValueError("订阅编号无效")
    return SUBSCRIPTION_DIR / f"{int(sub_id):03d}.conf"


def write_subscription(path: Path, name: str, url: str, enabled: bool) -> None:
    SUBSCRIPTION_DIR.mkdir(parents=True, exist_ok=True)
    content = "\n".join(
        [
            f"NAME={quote_value(name)}",
            f"URL={quote_value(url)}",
            f"ENABLED={quote_value('1' if enabled else '0')}",
            "",
        ]
    )
    path.write_text(content, encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def node_count() -> int:
    if not OUTBOUNDS_JSON.exists():
        return 0
    try:
        data = json.loads(OUTBOUNDS_JSON.read_text(encoding="utf-8-sig"))
    except Exception:
        return 0
    if isinstance(data, dict):
        data = data.get("outbounds", [])
    if not isinstance(data, list):
        return 0
    return len([item for item in data if isinstance(item, dict) and item.get("type") not in {"direct", "block"}])


PROXY_MODE_API_VALUES = {"rule": "Rule", "global": "Global", "direct": "Direct"}


def normalize_proxy_mode(value: str) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in PROXY_MODE_API_VALUES else "rule"


def clash_api_request(method: str, path: str, payload: dict | None = None) -> dict:
    conf = read_conf()
    panel_port = conf.get("PANEL_PORT", "9091")
    secret = conf.get("PANEL_SECRET", "abc123")
    headers = {"Accept": "application/json"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(f"http://127.0.0.1:{panel_port}{path}", data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=3) as response:
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"sing-box API 请求失败（HTTP {exc.code}）：{detail or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"无法连接 sing-box API：{exc.reason}") from exc
    if not raw:
        return {}
    data = json.loads(raw.decode("utf-8"))
    return data if isinstance(data, dict) else {}


def current_proxy_mode() -> str:
    try:
        return normalize_proxy_mode(clash_api_request("GET", "/configs").get("mode", "Rule"))
    except Exception:
        return "rule"


def proxy_delay(name: str) -> int | None:
    query = urlencode({"timeout": 5000, "url": "https://www.gstatic.com/generate_204"})
    try:
        result = clash_api_request("GET", f"/proxies/{quote(name, safe='')}/delay?{query}")
        delay = result.get("delay")
        return int(delay) if isinstance(delay, (int, float)) and delay > 0 else None
    except Exception:
        return None


def proxy_delays(names: list[str]) -> dict[str, int | None]:
    clean_names = list(dict.fromkeys(str(name).strip() for name in names if str(name).strip()))[:100]
    if not clean_names:
        return {}
    delays = {}
    with ThreadPoolExecutor(max_workers=min(8, len(clean_names))) as executor:
        futures = {executor.submit(proxy_delay, name): name for name in clean_names}
        for future in as_completed(futures):
            name = futures[future]
            try:
                delays[name] = future.result()
            except Exception:
                delays[name] = None
    return delays


def public_status() -> dict:
    conf = read_conf()
    lan_ip = conf.get("LAN_IP", "192.168.3.88")
    panel_port = conf.get("PANEL_PORT", "9091")
    proxy_port = conf.get("PROXY_PORT", "7890")
    admin_port = conf.get("ADMIN_PORT", "8088")
    zt_ip = detect_zt_ip()
    admin_active = systemctl_is_active("bypassproxy-admin")
    return {
        "services": {
            # Keep singBox for older clients, but expose the active core explicitly.
            "singBox": systemctl_is_active(kernel_service()),
            "kernel": current_kernel(),
            "kernelStatus": systemctl_is_active(kernel_service()),
            "forwardTimer": systemctl_is_active("bypassproxy-forward.timer"),
            "admin": admin_active,
        },
        "addresses": {
            "admin": f"http://{lan_ip}:{admin_port}/",
            "adminZeroTier": f"http://{zt_ip}:{admin_port}/" if zt_ip else "",
            "panel": f"http://{lan_ip}:{panel_port}/ui/",
            "proxy": f"http://{lan_ip}:{proxy_port}",
        },
        "ports": {"admin": admin_port, "panel": panel_port, "proxy": proxy_port},
        "tunEnabled": conf.get("TUN_ENABLE", "1").lower() not in {"0", "false", "off", "no", "disable", "disabled"},
        "proxyMode": current_proxy_mode(),
        "nodeCount": node_count(),
        "subscriptionCount": len(list_subscriptions()),
    }


def api_auth_ok(headers) -> bool:
    secret = read_conf().get("PANEL_SECRET", "abc123")
    if not secret:
        return True
    auth = headers.get("Authorization", "")
    return auth == f"Bearer {secret}"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, fmt, *args):
        return

    def end_headers(self):
        # The admin UI is updated in place; clients must not retain stale bundles.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError("JSON 格式不正确") from exc

    def require_auth(self) -> bool:
        if api_auth_ok(self.headers):
            return True
        self.send_json({"ok": False, "error": "未登录或密钥不正确"}, HTTPStatus.UNAUTHORIZED)
        return False

    def write_stream(self, text: str) -> bool:
        try:
            self.wfile.write(text.encode("utf-8", errors="replace"))
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError):
            return False

    def stream_step(self, title: str, args: list[str], timeout: int, env: dict[str, str] | None) -> int:
        if not self.write_stream(f"\n== {title} ==\n$ {' '.join(shlex.quote(item) for item in args)}\n"):
            return 499
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        try:
            process = subprocess.Popen(
                args,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=merged_env,
                bufsize=0,
                start_new_session=(os.name != "nt"),
            )
        except FileNotFoundError as exc:
            self.write_stream(f"{exc}\nFAILED code=127\n")
            return 127

        assert process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        started = time.monotonic()
        timed_out = False
        try:
            while True:
                if time.monotonic() - started > timeout:
                    timed_out = True
                    self.write_stream(f"\n命令超过 {timeout} 秒，已停止。\n")
                    stop_process(process)
                    break
                events = selector.select(timeout=0.2)
                for key, _ in events:
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    if not self.write_stream(chunk.decode("utf-8", errors="replace")):
                        stop_process(process)
                        return 499
                if process.poll() is not None and not selector.get_map():
                    break
                if process.poll() is not None:
                    for key in list(selector.get_map().values()):
                        try:
                            chunk = os.read(key.fileobj.fileno(), 4096)
                        except BlockingIOError:
                            chunk = b""
                        if chunk:
                            if not self.write_stream(chunk.decode("utf-8", errors="replace")):
                                return 499
                        else:
                            selector.unregister(key.fileobj)
        finally:
            selector.close()

        code = 124 if timed_out else int(process.wait() or 0)
        if code == 0:
            self.write_stream("\nOK code=0\n")
        else:
            self.write_stream(f"\nFAILED code={code}\n")
        return code

    def stream_action(self, action: str, data: dict) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            steps = action_steps(action, data)
        except Exception as exc:
            self.write_stream(f"FAILED: {exc}\n")
            return
        self.write_stream("开始执行，过程会实时显示在这里。\n")
        for title, args, timeout, env in steps:
            code = self.stream_step(title, args, timeout, env)
            if code != 0:
                if code != 499:
                    self.write_stream("\n后续步骤已停止，请先处理上面的错误。\n")
                return
        self.write_stream("\nDONE code=0\n")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/session":
            self.send_json({"ok": api_auth_ok(self.headers)})
            return
        if parsed.path == "/api/status":
            if not self.require_auth():
                return
            self.send_json(public_status())
            return
        if parsed.path == "/api/proxies":
            if not self.require_auth():
                return
            try:
                self.send_json(clash_api_request("GET", "/proxies"))
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_GATEWAY)
            return
        if parsed.path == "/api/connections":
            if not self.require_auth():
                return
            try:
                self.send_json(clash_api_request("GET", "/connections"))
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_GATEWAY)
            return
        if parsed.path == "/api/subscriptions":
            if not self.require_auth():
                return
            self.send_json({"items": list_subscriptions()})
            return
        if parsed.path == "/api/custom-rules":
            if not self.require_auth():
                return
            self.send_json({"rules": load_custom_rules()})
            return
        if parsed.path == "/api/settings/basic":
            if not self.require_auth():
                return
            conf = read_conf()
            keys = ["LAN_IF", "LAN_NET", "LAN_IP", "PROXY_PORT", "PANEL_PORT", "ADMIN_PORT", "TUN_ENABLE", "DNS1", "DNS2", "SUBSCRIBE_USER_AGENT", "DOWNLOAD_PROXY"]
            interfaces = list_network_interfaces()
            detected = detect_lan_settings(conf.get("LAN_IF", ""))
            settings = {key: conf.get(key, "") for key in keys}
            for key, value in detected.items():
                if not settings.get(key):
                    settings[key] = value
            self.send_json({"settings": settings, "interfaces": interfaces, "detected": detected})
            return
        if parsed.path == "/api/settings/sync":
            if not self.require_auth():
                return
            self.send_json({"settings": sync_settings()})
            return
        if parsed.path == "/api/logs":
            if not self.require_auth():
                return
            query = parse_qs(parsed.query)
            service = query.get("service", ["sing-box"])[0]
            if service not in {"sing-box", "bypassproxy-admin", "bypassproxy-forward"}:
                service = "sing-box"
            result = run_command(["journalctl", "-u", service, "-n", "160", "--no-pager"], timeout=20)
            self.send_json(result)
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/session":
            try:
                data = self.read_json()
                secret = read_conf().get("PANEL_SECRET", "abc123")
                self.send_json({"ok": data.get("secret") == secret})
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if not self.require_auth():
            return
        stream_match = re.fullmatch(r"/api/actions-stream/([a-z0-9-]+)", parsed.path)
        if stream_match:
            try:
                data = self.read_json()
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.stream_action(stream_match.group(1), data)
            return
        try:
            data = self.read_json()
            response = self.handle_post(parsed.path, data)
            self.send_json(response, HTTPStatus.OK if response.get("ok", True) else HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_PUT(self):
        if not self.require_auth():
            return
        parsed = urlparse(self.path)
        try:
            data = self.read_json()
            match = re.fullmatch(r"/api/subscriptions/(\d{1,3})", parsed.path)
            if not match:
                self.send_json({"ok": False, "error": "接口不存在"}, HTTPStatus.NOT_FOUND)
                return
            path = subscription_path(match.group(1))
            if not path.exists():
                self.send_json({"ok": False, "error": "订阅不存在"}, HTTPStatus.NOT_FOUND)
                return
            old = load_subscription(path)
            name = str(data.get("name") or old["name"]).strip()
            url = str(data.get("url") or old["url"]).strip()
            enabled = bool(data.get("enabled", old["enabled"]))
            if not url:
                raise ValueError("地址不能为空")
            write_subscription(path, name or url, url, enabled)
            self.send_json({"ok": True, "item": load_subscription(path)})
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_DELETE(self):
        if not self.require_auth():
            return
        parsed = urlparse(self.path)
        match = re.fullmatch(r"/api/subscriptions/(\d{1,3})", parsed.path)
        if not match:
            self.send_json({"ok": False, "error": "接口不存在"}, HTTPStatus.NOT_FOUND)
            return
        path = subscription_path(match.group(1))
        if path.exists():
            path.unlink()
        self.send_json({"ok": True})

    def handle_post(self, path: str, data: dict) -> dict:
        if path == "/api/subscriptions":
            name = str(data.get("name") or "").strip()
            url = str(data.get("url") or "").strip()
            if not url:
                raise ValueError("地址不能为空")
            sub_id = next_subscription_id()
            item_path = subscription_path(sub_id)
            write_subscription(item_path, name or url, url, bool(data.get("enabled", True)))
            return {"ok": True, "item": load_subscription(item_path)}
        match = re.fullmatch(r"/api/subscriptions/(\d{1,3})/toggle", path)
        if match:
            item_path = subscription_path(match.group(1))
            if not item_path.exists():
                raise ValueError("订阅不存在")
            item = load_subscription(item_path)
            write_subscription(item_path, item["name"], item["url"], not item["enabled"])
            return {"ok": True, "item": load_subscription(item_path)}
        if path == "/api/custom-rules":
            rules = save_custom_rules(data)
            return {"ok": True, "message": "自定义分流规则已保存。应用配置后生效。", "rules": rules}
        if path == "/api/settings/sync":
            provider = str(data.get("provider") or "webdav").strip().lower()
            if provider not in {"webdav", "s3"}:
                raise ValueError("同步方式无效")
            webdav_url = str(data.get("webdavUrl") or "").strip()
            webdav_username = str(data.get("webdavUsername") or "").strip()
            webdav_password = str(data.get("webdavPassword") or "")
            webdav_path = str(data.get("webdavPath") or "BypassProxy").strip().strip("/")
            s3_endpoint = str(data.get("s3Endpoint") or "").strip().rstrip("/")
            s3_bucket = str(data.get("s3Bucket") or "").strip()
            s3_region = str(data.get("s3Region") or "auto").strip() or "auto"
            s3_access_key = str(data.get("s3AccessKey") or "").strip()
            s3_secret_key = str(data.get("s3SecretKey") or "")
            s3_prefix = str(data.get("s3Prefix") or "BypassProxy").strip().strip("/")
            if webdav_url and not re.fullmatch(r"https?://.{3,300}", webdav_url):
                raise ValueError("WebDAV 地址格式无效")
            if webdav_path and not re.fullmatch(r"[A-Za-z0-9._@+\-/]{1,160}", webdav_path):
                raise ValueError("远端目录只能包含字母、数字、点、横线、下划线和斜杠")
            if s3_endpoint and not re.fullmatch(r"https?://.{3,300}", s3_endpoint):
                raise ValueError("S3 Endpoint 格式无效")
            if s3_bucket and not re.fullmatch(r"[A-Za-z0-9._-]{2,120}", s3_bucket):
                raise ValueError("S3 Bucket 格式无效")
            if s3_region and not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", s3_region):
                raise ValueError("S3 Region 格式无效")
            if s3_prefix and not re.fullmatch(r"[A-Za-z0-9._@+\-/]{1,200}", s3_prefix):
                raise ValueError("S3 Prefix 只能包含字母、数字、点、横线、下划线和斜杠")
            save_conf_key("SYNC_PROVIDER", provider)
            save_conf_key("WEBDAV_URL", webdav_url)
            save_conf_key("WEBDAV_USERNAME", webdav_username)
            if webdav_password:
                save_conf_key("WEBDAV_PASSWORD", webdav_password)
            save_conf_key("WEBDAV_PATH", webdav_path or "BypassProxy")
            save_conf_key("S3_ENDPOINT", s3_endpoint)
            save_conf_key("S3_BUCKET", s3_bucket)
            save_conf_key("S3_REGION", s3_region)
            save_conf_key("S3_ACCESS_KEY", s3_access_key)
            if s3_secret_key:
                save_conf_key("S3_SECRET_KEY", s3_secret_key)
            save_conf_key("S3_PREFIX", s3_prefix or "BypassProxy")
            return {"ok": True, "message": "同步设置已保存", "settings": sync_settings()}
        if path == "/api/settings/admin-port":
            port = str(data.get("port") or "").strip()
            if not re.fullmatch(r"\d{2,5}", port) or not (1 <= int(port) <= 65535):
                raise ValueError("端口无效")
            save_conf_key("ADMIN_PORT", port)
            return {"ok": True, "message": "端口已保存，重启 Web 管理页后生效"}
        if path == "/api/proxies/apply-group":
            group = str(data.get("group") or "").strip()
            if not group:
                raise ValueError("请选择要应用的订阅组")
            all_proxies = clash_api_request("GET", "/proxies").get("proxies", {})
            candidate_name = next(
                (name for name in all_proxies if str(name).strip().casefold() == group.casefold()),
                None,
            )
            candidate = all_proxies.get(candidate_name, {}) if candidate_name else {}
            members = candidate.get("all") if isinstance(candidate, dict) else None
            if not isinstance(members, list) or not members:
                raise ValueError("所选分组不存在或没有可用节点")

            selected_node = str(candidate.get("now") or members[0]).strip()
            if current_kernel() == "sing-box":
                proxy_group_name = next(
                    (name for name in all_proxies if str(name).strip().casefold() == "proxy"),
                    None,
                )
                if not proxy_group_name:
                    raise RuntimeError("sing-box 主选择器不存在")
                proxy_members = all_proxies.get(proxy_group_name, {}).get("all", [])
                if candidate_name not in proxy_members:
                    raise ValueError("所选订阅组不在 sing-box 主选择器中，请先更新并应用订阅")

                # sing-box uses nested selectors: route the main proxy
                # selector to the selected subscription or auto selector.
                clash_api_request("PUT", f"/proxies/{quote(proxy_group_name, safe='')}", {"name": candidate_name})
                refreshed = clash_api_request("GET", "/proxies").get("proxies", {})
                proxy_now = str(refreshed.get(proxy_group_name, {}).get("now", ""))
                group_now = str(refreshed.get(candidate_name, {}).get("now", ""))
                if proxy_now != candidate_name:
                    raise RuntimeError("sing-box 主选择器未切换到所选分组，请重试")
                return {
                    "ok": True,
                    "selectedGroup": candidate_name,
                    "selectedNode": group_now or selected_node,
                    "groupNow": group_now,
                    "proxyNow": proxy_now,
                }

            proxy_group_name = next(
                (name for name in all_proxies if str(name).strip().casefold() == "proxy"),
                "PROXY",
            )
            global_group_name = next(
                (name for name in all_proxies if str(name).strip().casefold() == "global"),
                "GLOBAL",
            )
            proxy_members = all_proxies.get(proxy_group_name, {}).get("all", [])
            if selected_node not in proxy_members:
                raise ValueError("所选分组的当前节点不在主代理组中，请先刷新订阅并应用")

            # Selector groups keep their own selection. URLTest groups choose
            # automatically and cannot be changed through the selector PUT.
            candidate_type = str(candidate.get("type") or "").strip().casefold()
            automatic_group = str(candidate_name or "").strip().casefold() == "自动选择".casefold()
            selected_proxy = candidate_name if automatic_group else selected_node
            if not automatic_group and candidate_type not in {"urltest", "fallback", "loadbalance"}:
                clash_api_request("PUT", f"/proxies/{quote(candidate_name, safe='')}", {"name": selected_node})
            # Keep the automatic group selected in PROXY so url-test can continue
            # choosing nodes; manual subscription groups use a concrete node.
            clash_api_request("PUT", f"/proxies/{quote(proxy_group_name, safe='')}", {"name": selected_proxy})
            clash_api_request("PUT", f"/proxies/{quote(global_group_name, safe='')}", {"name": proxy_group_name})

            refreshed = clash_api_request("GET", "/proxies").get("proxies", {})
            proxy_now = refreshed.get(proxy_group_name, {}).get("now", "")
            global_now = refreshed.get(global_group_name, {}).get("now", "")
            group_now = refreshed.get(candidate_name, {}).get("now", "")
            if proxy_now != selected_proxy or global_now != proxy_group_name:
                raise RuntimeError("mihomo 未确认主代理组同步，请重试")
            return {
                "ok": True,
                "selectedGroup": candidate_name,
                "selectedNode": group_now or selected_node,
                "groupNow": group_now,
                "proxyNow": proxy_now,
                "globalNow": global_now,
            }
        if path == "/api/proxies/select":
            group = str(data.get("group") or "").strip()
            name = str(data.get("name") or "").strip()
            if not group or not name:
                raise ValueError("节点组和节点名称不能为空")
            selected_name = name
            selected_group = ""
            if current_kernel() == "sing-box":
                all_proxies = clash_api_request("GET", "/proxies").get("proxies", {})
                target_group_name = next(
                    (candidate_name for candidate_name in all_proxies if str(candidate_name).strip().casefold() == group.casefold()),
                    None,
                )
                target_group = all_proxies.get(target_group_name, {}) if target_group_name else {}
                members = target_group.get("all") if isinstance(target_group, dict) else None
                proxy_group_name = next(
                    (candidate_name for candidate_name in all_proxies if str(candidate_name).strip().casefold() == "proxy"),
                    None,
                )
                if target_group_name and isinstance(members, list) and members:
                    if name not in members:
                        raise ValueError("所选节点不属于当前订阅组")
                    if str(target_group.get("type", "")).strip().casefold() == "selector":
                        clash_api_request("PUT", f"/proxies/{quote(target_group_name, safe='')}", {"name": name})
                    selected_group = target_group_name
                    selected_name = name
                    if proxy_group_name:
                        clash_api_request("PUT", f"/proxies/{quote(proxy_group_name, safe='')}", {"name": target_group_name})
                elif group.casefold() == "proxy" and proxy_group_name:
                    proxy_members = all_proxies.get(proxy_group_name, {}).get("all", [])
                    if name not in proxy_members:
                        raise ValueError("所选节点不属于主代理组")
                    clash_api_request("PUT", f"/proxies/{quote(proxy_group_name, safe='')}", {"name": name})
                else:
                    raise ValueError("sing-box 无法解析所选订阅组，请刷新节点列表后重试")

                refreshed = clash_api_request("GET", "/proxies").get("proxies", {})
                if target_group_name and refreshed.get(target_group_name, {}).get("now") != selected_name:
                    raise RuntimeError("sing-box 未确认节点切换，请重试")
                if proxy_group_name and target_group_name and refreshed.get(proxy_group_name, {}).get("now") != target_group_name:
                    raise RuntimeError("sing-box 主选择器未同步订阅组，请重试")
                return {"ok": True, "group": group, "name": selected_name, "selectedGroup": selected_group or None}

            if current_kernel() == "mihomo" and group.lower() == "proxy":
                # mihomo's REST API accepts a real proxy name for PROXY, not a
                # nested proxy-group name. Resolve a requested subscription group
                # to its current/first node before applying it.
                try:
                    all_proxies = clash_api_request("GET", "/proxies").get("proxies", {})
                    candidate = all_proxies.get(name, {}) if isinstance(all_proxies, dict) else {}
                    if not candidate and isinstance(all_proxies, dict):
                        wanted = name.strip().casefold()
                        for candidate_name, candidate_value in all_proxies.items():
                            if str(candidate_name).strip().casefold() == wanted:
                                candidate = candidate_value
                                break
                except Exception:
                    candidate = {}
                members = candidate.get("all") if isinstance(candidate, dict) else None
                if isinstance(members, list) and members:
                    selected_group = name
                    selected_name = str(candidate.get("now") or members[0])
                elif isinstance(all_proxies, dict) and name not in (all_proxies.get("PROXY", {}).get("all") or []):
                    raise ValueError("mihomo 无法解析所选订阅组，请刷新节点列表后重试")
            clash_api_request("PUT", f"/proxies/{quote(group, safe='')}", {"name": selected_name})
            # MetaCubeXD usually opens mihomo's GLOBAL selector. GLOBAL cannot
            # select a proxy-group directly, so point it at the main PROXY group;
            # PROXY then carries the selected subscription group or node.
            if current_kernel() == "mihomo":
                if group.lower() != "proxy" and selected_name:
                    clash_api_request("PUT", "/proxies/PROXY", {"name": selected_name})
                clash_api_request("PUT", "/proxies/GLOBAL", {"name": "PROXY"})
                refreshed = clash_api_request("GET", "/proxies").get("proxies", {})
                if refreshed.get("PROXY", {}).get("now") != selected_name or refreshed.get("GLOBAL", {}).get("now") != "PROXY":
                    raise RuntimeError("mihomo 未确认节点同步，请重试")
            return {"ok": True, "group": group, "name": selected_name, "selectedGroup": selected_group or None}
        if path == "/api/proxies/delay":
            names = data.get("names")
            if not isinstance(names, list):
                raise ValueError("节点列表格式无效")
            return {"ok": True, "delays": proxy_delays(names)}
        if path == "/api/connections/close-all":
            clash_api_request("DELETE", "/connections")
            return {"ok": True}
        if path == "/api/connections/close":
            connection_id = str(data.get("id") or "").strip()
            if not connection_id:
                raise ValueError("连接 ID 不能为空")
            clash_api_request("DELETE", f"/connections/{quote(connection_id, safe='')}")
            return {"ok": True}
        if path == "/api/proxy-mode":
            requested = str(data.get("mode") or "").strip().lower()
            if requested not in PROXY_MODE_API_VALUES:
                raise ValueError("代理模式无效")
            clash_api_request("PATCH", "/configs", {"mode": PROXY_MODE_API_VALUES[requested]})
            active = current_proxy_mode()
            if active != requested:
                raise RuntimeError("sing-box 没有切换到所选模式，请先应用最新配置")
            try:
                clash_api_request("DELETE", "/connections")
            except Exception:
                pass
            labels = {"rule": "规则", "global": "全局", "direct": "直连"}
            return {"ok": True, "proxyMode": active, "message": f"已切换到{labels[active]}模式，旧连接已清理"}
        if path == "/api/settings/basic":
            selected_if = str(data.get("LAN_IF") or "").strip()
            detected = detect_lan_settings(selected_if)
            if selected_if and detected.get("LAN_IF") == selected_if:
                data["LAN_IP"] = detected.get("LAN_IP") or data.get("LAN_IP", "")
                data["LAN_NET"] = detected.get("LAN_NET") or data.get("LAN_NET", "")
            allowed = {
                "LAN_IF": r"^[A-Za-z0-9_.:-]{1,64}$",
                "LAN_NET": r"^[0-9A-Fa-f:.\/]{3,64}$",
                "LAN_IP": r"^[0-9A-Fa-f:.]{3,64}$",
                "PROXY_PORT": r"^\d{2,5}$",
                "PANEL_PORT": r"^\d{2,5}$",
                "ADMIN_PORT": r"^\d{2,5}$",
                "TUN_ENABLE": r"^(0|1|true|false|on|off|yes|no|enable|disable|enabled|disabled)$",
                "KERNEL": r"^(sing-box|mihomo)$",
                "DNS1": r"^[0-9A-Fa-f:.]{3,64}$",
                "DNS2": r"^[0-9A-Fa-f:.]{0,64}$",
                "SUBSCRIBE_USER_AGENT": r"^.{0,120}$",
                "DOWNLOAD_PROXY": r"^.{0,300}$",
            }
            for key, pattern in allowed.items():
                value = str(data.get(key, "")).strip()
                if value and not re.fullmatch(pattern, value):
                    raise ValueError(f"{key} 格式无效")
                if key.endswith("PORT") and value and not (1 <= int(value) <= 65535):
                    raise ValueError(f"{key} 端口无效")
                if key == "TUN_ENABLE":
                    value = "0" if value.lower() in {"0", "false", "off", "no", "disable", "disabled"} else "1"
                save_conf_key(key, value)
            return {"ok": True, "message": "基础设置已保存。端口类修改需要应用配置或重启相关服务后生效。"}
        if path == "/api/settings/panel-secret":
            current = str(data.get("current") or "")
            new_secret = str(data.get("newSecret") or "").strip()
            confirm = str(data.get("confirm") or "").strip()
            old_secret = read_conf().get("PANEL_SECRET", "abc123")
            if old_secret and current != old_secret:
                raise ValueError("当前密钥不正确")
            if len(new_secret) < 4:
                raise ValueError("新密钥至少 4 位")
            if new_secret != confirm:
                raise ValueError("两次输入的新密钥不一致")
            save_conf_key("PANEL_SECRET", new_secret)
            render = self.handle_post("/api/actions/render-config", {})
            if render.get("ok"):
                restart = run_command(["systemctl", "restart", kernel_service()], timeout=40)
                render["restart"] = restart
                render["ok"] = restart["ok"]
                render["output"] = (render.get("output", "") + "\n" + restart.get("output", "")).strip()
            return {"ok": bool(render.get("ok")), "message": "登录密钥已修改，请重新登录", "output": render.get("output", "")}
        if path == "/api/actions/update-subscription":
            env = {"ROUTER_CONF": str(CONF)}
            if data.get("direct"):
                env["BYPASSPROXY_DIRECT_DOWNLOAD"] = "1"
            result = run_command(["/usr/local/sbin/bypassproxy-update-subscription.sh"], timeout=240, env=env)
            if result["ok"]:
                apply = self.handle_post("/api/actions/apply-config", {})
                result["apply"] = apply
                result["ok"] = apply.get("ok", False)
            return result
        if path == "/api/actions/render-config":
            render_cmd, render_env = kernel_render_command()
            result = run_command(
                render_cmd,
                timeout=60,
                env=render_env,
            )
            if result["ok"]:
                check = run_command(kernel_config_command(), timeout=60)
                result["check"] = check
                result["ok"] = check["ok"]
                result["output"] = (result["output"] + "\n" + check["output"]).strip()
            return result
        if path == "/api/actions/apply-config":
            result = self.handle_post("/api/actions/render-config", {})
            if result["ok"]:
                restart = run_command(["systemctl", "restart", kernel_service()], timeout=40)
                result["restart"] = restart
                result["ok"] = restart["ok"]
                result["output"] = (result["output"] + "\n" + restart["output"]).strip()
            return result
        if path == "/api/actions/restart-sing-box":
            return run_command(["systemctl", "restart", kernel_service()], timeout=40)
        if path == "/api/actions/pause-proxy":
            return run_command(["systemctl", "disable", "--now", kernel_service()], timeout=40)
        if path == "/api/actions/resume-proxy":
            result = self.handle_post("/api/actions/apply-config", {})
            if result["ok"]:
                enable = run_command(["systemctl", "enable", "--now", kernel_service()], timeout=40)
                forward = run_command(["/usr/local/sbin/bypassproxy-forward.sh"], timeout=60, env={"ROUTER_CONF": str(CONF)})
                result["enable"] = enable
                result["forward"] = forward
                result["ok"] = enable["ok"] and forward["ok"]
                result["output"] = (result["output"] + "\n" + enable["output"] + "\n" + forward["output"]).strip()
            return result
        if path == "/api/actions/check-config":
            return run_command(kernel_config_command(), timeout=60)
        if path == "/api/actions/update-rulesets":
            return run_command(["/usr/local/sbin/bypassproxy-update-rulesets.sh"], timeout=180, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/update-webui":
            return run_command(["/usr/local/sbin/bypassproxy-update-webui.sh"], timeout=240, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/update-core":
            return run_command(["/usr/local/sbin/bypassproxy-update-core.sh"], timeout=360, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/diagnose-network":
            return run_command(["/usr/local/sbin/bypassproxy-diagnose-network.sh"], timeout=180, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/test-lan-client":
            return run_command(["/usr/local/sbin/bypassproxy-client-test.sh"], timeout=120, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/speed-test":
            return run_command(["/usr/local/sbin/bypassproxy-speed-test.sh"], timeout=90, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/repair":
            return run_command(["/usr/local/sbin/bypassproxy-repair.sh"], timeout=300, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/apply-forwarding":
            return run_command(["/usr/local/sbin/bypassproxy-forward.sh"], timeout=60, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/backup-local":
            return run_command(["/usr/local/sbin/bypassproxy-backup-sync.sh", "backup"], timeout=120, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/sync-test":
            return run_command(["/usr/local/sbin/bypassproxy-backup-sync.sh", "test"], timeout=120, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/sync-upload":
            return run_command(["/usr/local/sbin/bypassproxy-backup-sync.sh", "upload"], timeout=300, env={"ROUTER_CONF": str(CONF)})
        if path == "/api/actions/sync-restore-latest":
            return run_command(["/usr/local/sbin/bypassproxy-backup-sync.sh", "restore-latest"], timeout=300, env={"ROUTER_CONF": str(CONF)})
        return {"ok": False, "error": "接口不存在"}


def main() -> None:
    conf = read_conf()
    host = os.environ.get("ADMIN_HOST", "0.0.0.0")
    port = int(os.environ.get("ADMIN_PORT", conf.get("ADMIN_PORT", "8088")))
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"BypassProxy admin listening on {host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
