#!/usr/bin/env python3
import base64
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import yaml


def tls_config(proxy, default=True):
    tls = {"enabled": bool(proxy.get("tls", default))}
    server_name = proxy.get("servername") or proxy.get("sni")
    if server_name:
        tls["server_name"] = server_name
    if proxy.get("skip-cert-verify") is not None:
        tls["insecure"] = bool(proxy.get("skip-cert-verify"))
    fp = proxy.get("client-fingerprint")
    if fp:
        tls["utls"] = {"enabled": True, "fingerprint": fp}
    reality = proxy.get("reality-opts") or {}
    if reality:
        tls["reality"] = {
            "enabled": True,
            "public_key": reality.get("public-key") or reality.get("public_key", ""),
        }
        sid = reality.get("short-id") or reality.get("short_id")
        if sid:
            tls["reality"]["short_id"] = sid
    return tls


def truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "tls"}


def decode_base64_text(value: str) -> str:
    raw = value.strip()
    raw += "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw.encode()).decode("utf-8", "replace")


def first_param(params: dict[str, list[str]], *names: str, default: str = "") -> str:
    for name in names:
        values = params.get(name)
        if values:
            return values[0]
    return default


def bool_param(params: dict[str, list[str]], *names: str, default=False) -> bool:
    value = first_param(params, *names, default=str(default))
    return truthy(value)


def split_host_port(netloc: str, default_port: int) -> tuple[str, int]:
    host = netloc.rsplit("@", 1)[-1]
    if host.startswith("[") and "]" in host:
        end = host.index("]")
        name = host[1:end]
        rest = host[end + 1 :]
        port = int(rest[1:]) if rest.startswith(":") and rest[1:] else default_port
        return name, port
    if ":" in host:
        name, port = host.rsplit(":", 1)
        return name, int(port or default_port)
    return host, default_port


def common_tls_from_params(params: dict[str, list[str]], default=False) -> dict:
    security = first_param(params, "security", default="")
    tls = {"enabled": security in {"tls", "reality"} or (default and security != "none")}
    server_name = first_param(params, "sni", "servername", "peer", default="")
    if server_name:
        tls["server_name"] = server_name
    if bool_param(params, "allowInsecure", "allow_insecure", "skip-cert-verify", default=False):
        tls["insecure"] = True
    fp = first_param(params, "fp", "client-fingerprint", "client_fingerprint", default="")
    if fp:
        tls["utls"] = {"enabled": True, "fingerprint": fp}
    if security == "reality":
        reality = {"enabled": True}
        public_key = first_param(params, "pbk", "public-key", "public_key", default="")
        short_id = first_param(params, "sid", "short-id", "short_id", default="")
        if public_key:
            reality["public_key"] = public_key
        if short_id:
            reality["short_id"] = short_id
        tls["reality"] = reality
    return tls


def transport_from_link(params: dict[str, list[str]]) -> dict | None:
    network = first_param(params, "type", "network", default="tcp").lower()
    if network == "ws":
        transport = {"type": "ws"}
        path = first_param(params, "path", default="")
        host = first_param(params, "host", default="")
        if path:
            transport["path"] = path
        if host:
            transport["headers"] = {"Host": host}
        return transport
    if network == "grpc":
        transport = {"type": "grpc"}
        service_name = first_param(params, "serviceName", "service-name", "service_name", default="")
        if service_name:
            transport["service_name"] = service_name
        return transport
    if network in {"http", "h2"}:
        transport = {"type": "http"}
        path = first_param(params, "path", default="")
        host = first_param(params, "host", default="")
        if path:
            transport["path"] = path
        if host:
            transport["host"] = [host]
        return transport
    return None


def link_name(parsed, fallback: str) -> str:
    return unquote(parsed.fragment) if parsed.fragment else fallback


def vmess_transport(network: str, opts: dict) -> dict | None:
    network = (network or "tcp").lower()
    if network == "ws":
        transport = {"type": "ws"}
        path = opts.get("path")
        if path:
            transport["path"] = str(path)
        headers = opts.get("headers") or {}
        host = opts.get("host")
        if host and "Host" not in headers:
            headers["Host"] = host
        if headers:
            transport["headers"] = {str(k): str(v) for k, v in headers.items() if v}
        return transport
    if network == "grpc":
        transport = {"type": "grpc"}
        service_name = opts.get("serviceName") or opts.get("service-name") or opts.get("service_name")
        if service_name:
            transport["service_name"] = str(service_name)
        return transport
    if network in {"http", "h2"}:
        transport = {"type": "http"}
        path = opts.get("path")
        if path:
            transport["path"] = str(path)
        host = opts.get("host")
        if host:
            transport["host"] = [str(host)]
        return transport
    return None


def convert_vmess(proxy):
    tag = str(proxy.get("name", "")).strip()
    server = str(proxy.get("server", "")).strip()
    if not tag:
        tag = f"{server}:{proxy.get('port', 443)}"
    outbound = {
        "type": "vmess",
        "tag": tag,
        "server": server,
        "server_port": int(proxy.get("port", 443)),
        "uuid": str(proxy.get("uuid") or proxy.get("id") or ""),
        "security": str(proxy.get("cipher") or proxy.get("security") or proxy.get("scy") or "auto"),
        "alter_id": int(proxy.get("alterId") or proxy.get("alter-id") or proxy.get("aid") or 0),
    }
    if proxy.get("udp") is True:
        outbound["network"] = "udp"

    tls = tls_config(proxy, default=False)
    if tls["enabled"]:
        outbound["tls"] = tls

    network = str(proxy.get("network") or proxy.get("net") or "tcp").lower()
    opts = {}
    if network == "ws":
        ws = proxy.get("ws-opts") or {}
        opts["path"] = ws.get("path") or proxy.get("path")
        opts["headers"] = ws.get("headers") or {}
        opts["host"] = proxy.get("host")
    elif network == "grpc":
        opts.update(proxy.get("grpc-opts") or {})
    elif network in {"http", "h2"}:
        h2 = proxy.get("h2-opts") or {}
        opts["path"] = h2.get("path") or proxy.get("path")
        hosts = h2.get("host") or proxy.get("host")
        if isinstance(hosts, list):
            opts["host"] = hosts[0] if hosts else ""
        else:
            opts["host"] = hosts
    transport = vmess_transport(network, opts)
    if transport:
        outbound["transport"] = transport
    return outbound


def convert(proxy):
    typ = str(proxy.get("type", "")).lower()
    tag = str(proxy.get("name", "")).strip()
    if typ in {"hysteria2", "hy2"}:
        return {
            "type": "hysteria2",
            "tag": tag,
            "server": str(proxy["server"]),
            "server_port": int(proxy.get("port", 443)),
            "password": str(proxy.get("password", "")),
            "tls": tls_config(proxy),
        }
    if typ == "vless":
        outbound = {
            "type": "vless",
            "tag": tag,
            "server": str(proxy["server"]),
            "server_port": int(proxy.get("port", 443)),
            "uuid": str(proxy.get("uuid", "")),
            "tls": tls_config(proxy),
        }
        if proxy.get("flow"):
            outbound["flow"] = proxy["flow"]
        if proxy.get("network") == "ws":
            ws = proxy.get("ws-opts") or {}
            transport = {"type": "ws"}
            if ws.get("path"):
                transport["path"] = ws["path"]
            if ws.get("headers"):
                transport["headers"] = {str(k): str(v) for k, v in ws["headers"].items()}
            outbound["transport"] = transport
        return outbound
    if typ == "vmess":
        return convert_vmess(proxy)
    if typ == "trojan":
        outbound = {
            "type": "trojan",
            "tag": tag,
            "server": str(proxy["server"]),
            "server_port": int(proxy.get("port", 443)),
            "password": str(proxy.get("password", "")),
        }
        tls = tls_config(proxy, default=True)
        if tls["enabled"]:
            outbound["tls"] = tls
        network = str(proxy.get("network") or "tcp").lower()
        if network == "ws":
            ws = proxy.get("ws-opts") or {}
            transport = {"type": "ws"}
            if ws.get("path"):
                transport["path"] = ws["path"]
            if ws.get("headers"):
                transport["headers"] = {str(k): str(v) for k, v in ws["headers"].items()}
            outbound["transport"] = transport
        return outbound
    if typ in {"ss", "shadowsocks"}:
        return {
            "type": "shadowsocks",
            "tag": tag,
            "server": str(proxy["server"]),
            "server_port": int(proxy.get("port", 8388)),
            "method": str(proxy.get("cipher") or proxy.get("method") or ""),
            "password": str(proxy.get("password", "")),
        }
    return None


def vmess_link_to_proxy(link: str) -> dict:
    body = link.strip()[len("vmess://") :]
    data = json.loads(decode_base64_text(body))
    proxy = {
        "type": "vmess",
        "name": data.get("ps") or data.get("remark") or data.get("add") or "vmess",
        "server": data.get("add"),
        "port": data.get("port") or 443,
        "uuid": data.get("id"),
        "alterId": data.get("aid") or 0,
        "security": data.get("scy") or data.get("security") or "auto",
        "network": data.get("net") or "tcp",
        "tls": str(data.get("tls", "")).lower() == "tls",
        "servername": data.get("sni") or data.get("servername") or "",
        "skip-cert-verify": truthy(data.get("allowInsecure", False)),
        "path": data.get("path") or "",
        "host": data.get("host") or "",
    }
    alpn = data.get("alpn")
    if alpn:
        proxy["alpn"] = alpn
    return proxy


def vless_link_to_outbound(link: str) -> dict:
    parsed = urlparse(link.strip())
    params = parse_qs(parsed.query)
    uuid = unquote(parsed.username or "")
    server, port = split_host_port(parsed.netloc, 443)
    outbound = {
        "type": "vless",
        "tag": link_name(parsed, server or "vless"),
        "server": server,
        "server_port": port,
        "uuid": uuid,
    }
    flow = first_param(params, "flow", default="")
    if flow:
        outbound["flow"] = flow
    tls = common_tls_from_params(params, default=False)
    if tls["enabled"]:
        outbound["tls"] = tls
    transport = transport_from_link(params)
    if transport:
        outbound["transport"] = transport
    return outbound


def trojan_link_to_outbound(link: str) -> dict:
    parsed = urlparse(link.strip())
    params = parse_qs(parsed.query)
    password = unquote(parsed.username or "")
    server, port = split_host_port(parsed.netloc, 443)
    outbound = {
        "type": "trojan",
        "tag": link_name(parsed, server or "trojan"),
        "server": server,
        "server_port": port,
        "password": password,
    }
    tls = common_tls_from_params(params, default=True)
    if tls["enabled"]:
        outbound["tls"] = tls
    transport = transport_from_link(params)
    if transport:
        outbound["transport"] = transport
    return outbound


def ss_link_to_outbound(link: str) -> dict:
    parsed = urlparse(link.strip())
    body = link.strip()[len("ss://") :].split("#", 1)[0].split("?", 1)[0]
    if "@" not in body:
        decoded = decode_base64_text(body)
        userinfo, endpoint = decoded.rsplit("@", 1)
        server, port = split_host_port(endpoint, 8388)
        method, password = userinfo.split(":", 1)
        return {
            "type": "shadowsocks",
            "tag": link_name(parsed, server or "shadowsocks"),
            "server": server,
            "server_port": port,
            "method": method,
            "password": password,
        }

    userinfo = parsed.username or ""
    if ":" not in userinfo:
        try:
            userinfo = decode_base64_text(userinfo)
        except Exception:
            userinfo = unquote(userinfo)
    else:
        userinfo = unquote(userinfo)
    method, password = userinfo.split(":", 1)
    server, port = split_host_port(parsed.netloc, 8388)
    return {
        "type": "shadowsocks",
        "tag": link_name(parsed, server or "shadowsocks"),
        "server": server,
        "server_port": port,
        "method": method,
        "password": password,
    }


def hysteria2_link_to_outbound(link: str) -> dict:
    parsed = urlparse(link.strip())
    params = parse_qs(parsed.query)
    password = unquote(parsed.username or "")
    server, port = split_host_port(parsed.netloc, 443)
    outbound = {
        "type": "hysteria2",
        "tag": link_name(parsed, server or "hysteria2"),
        "server": server,
        "server_port": port,
        "password": password or first_param(params, "password", "auth", default=""),
        "tls": common_tls_from_params(params, default=True),
    }
    obfs = first_param(params, "obfs", default="")
    obfs_password = first_param(params, "obfs-password", "obfs_password", default="")
    if obfs:
        outbound["obfs"] = {"type": obfs}
        if obfs_password:
            outbound["obfs"]["password"] = obfs_password
    return outbound


def parse_link_line(line: str) -> dict | None:
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    if line.startswith("vmess://"):
        return convert(vmess_link_to_proxy(line))
    if line.startswith("vless://"):
        return vless_link_to_outbound(line)
    if line.startswith("trojan://"):
        return trojan_link_to_outbound(line)
    if line.startswith("ss://"):
        return ss_link_to_outbound(line)
    if line.startswith("hysteria2://") or line.startswith("hy2://"):
        return hysteria2_link_to_outbound(line)
    return None


def maybe_decode_subscription(text: str) -> str:
    compact = "".join(text.strip().split())
    if not compact or "://" in text or "proxies:" in text:
        return text
    try:
        decoded = decode_base64_text(compact)
    except Exception:
        return text
    if "://" in decoded or "proxies:" in decoded:
        return decoded
    return text


def extract_from_yaml(text: str) -> list[dict]:
    config = yaml.safe_load(text)
    if not isinstance(config, dict):
        return []
    outbounds = []
    for proxy in config.get("proxies", []) or []:
        if not isinstance(proxy, dict):
            continue
        item = convert(proxy)
        if item:
            outbounds.append(item)
    return outbounds


def extract_from_text(text: str) -> list[dict]:
    text = maybe_decode_subscription(text)
    outbounds = []
    for line in text.splitlines():
        item = parse_link_line(line)
        if item:
            outbounds.append(item)
    if outbounds:
        return outbounds
    try:
        return extract_from_yaml(text)
    except Exception:
        return []


def unique_tags(outbounds: list[dict]) -> list[dict]:
    used = {}
    result = []
    for outbound in outbounds:
        tag = str(outbound.get("tag") or outbound.get("server") or outbound.get("type")).strip()
        base = tag
        if base in used:
            used[base] += 1
            tag = f"{base} #{used[base]}"
        else:
            used[base] = 1
        outbound["tag"] = tag
        result.append(outbound)
    return result


def load_manifest(source_args: list[str]) -> dict[str, dict[str, str]]:
    candidates = []
    for item in source_args:
        path = Path(item)
        if path.is_dir():
            candidates.append(path / "manifest.json")
        else:
            candidates.append(path.parent / "manifest.json")
    for candidate in candidates:
        if not candidate.exists():
            continue
        try:
            data = json.loads(candidate.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        result = {}
        for entry in data:
            if not isinstance(entry, dict):
                continue
            file_name = str(entry.get("file") or "").strip()
            if not file_name:
                continue
            result[file_name] = {
                "id": str(entry.get("id") or "").strip(),
                "name": str(entry.get("name") or "").strip(),
            }
        if result:
            return result
    return {}


def annotate_subscription(outbounds: list[dict], source: Path, manifest: dict[str, dict[str, str]]) -> list[dict]:
    meta = manifest.get(source.name)
    if not meta:
        return outbounds
    name = meta.get("name") or meta.get("id") or source.stem
    sub_id = meta.get("id") or source.stem
    for outbound in outbounds:
        outbound["_subscription"] = name
        outbound["_subscription_id"] = sub_id
    return outbounds


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("用法：extract-outbounds.py 订阅文件... outbounds.json")
    source_args = sys.argv[1:-1]
    manifest = load_manifest(source_args)
    sources = []
    for item in source_args:
        path = Path(item)
        if path.is_dir():
            sources.extend(sorted(child for child in path.iterdir() if child.is_file() and child.name != "manifest.json"))
        else:
            sources.append(path)
    target = Path(sys.argv[-1])
    outbounds = []
    for source in sources:
        extracted = extract_from_text(source.read_text(encoding="utf-8-sig"))
        outbounds.extend(annotate_subscription(extracted, source, manifest))
    outbounds = unique_tags(outbounds)
    if not outbounds:
        raise SystemExit("没有找到支持的 hysteria2/vless/vmess/trojan/shadowsocks 节点")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(outbounds, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入 {len(outbounds)} 个节点到 {target}")


if __name__ == "__main__":
    main()
