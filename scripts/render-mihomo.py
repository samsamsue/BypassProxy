#!/usr/bin/env python3
"""Render a mihomo config from the normalized BypassProxy outbounds file."""
import ipaddress
import json
import os
import re
from pathlib import Path


def conf(path: Path) -> dict[str, str]:
    values = {}
    if path.exists():
        for raw in path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip("'\"")
    return values


def normalize_domain(value: str) -> str:
    value = str(value or "").strip().lower()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = re.split(r"[/?#]", value, maxsplit=1)[0]
    value = value.split(":", 1)[0]
    value = value.lstrip("*.").strip(".")
    if not value or any(char.isspace() for char in value):
        return ""
    return value


def normalize_ip(value: str) -> str:
    try:
        return str(ipaddress.ip_network(str(value or "").strip(), strict=False))
    except ValueError:
        return ""


def load_custom_rules(path: Path) -> dict[str, list[str]]:
    result = {
        "directDomains": [],
        "directIps": [],
        "proxyDomains": [],
        "proxyIps": [],
    }
    if not path.exists():
        return result
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise SystemExit("自定义分流规则必须是 JSON 对象")
    aliases = {
        "directDomains": ("directDomains", "direct_domains"),
        "directIps": ("directIps", "direct_ips"),
        "proxyDomains": ("proxyDomains", "proxy_domains"),
        "proxyIps": ("proxyIps", "proxy_ips"),
    }
    for key, names in aliases.items():
        values = []
        for name in names:
            if isinstance(data.get(name), list):
                values = data[name]
                break
        seen = set()
        for value in values:
            normalized = normalize_ip(value) if key.endswith("Ips") else normalize_domain(value)
            if normalized and normalized not in seen:
                seen.add(normalized)
                result[key].append(normalized)
    return result


def build_rules(custom_rules: dict[str, list[str]]) -> list[str]:
    rules = []
    for domain in custom_rules["proxyDomains"]:
        rules.append(f"DOMAIN-SUFFIX,{domain},PROXY")
    for cidr in custom_rules["proxyIps"]:
        rules.append(f"IP-CIDR,{cidr},PROXY,no-resolve")
    for domain in custom_rules["directDomains"]:
        rules.append(f"DOMAIN-SUFFIX,{domain},DIRECT")
    for cidr in custom_rules["directIps"]:
        rules.append(f"IP-CIDR,{cidr},DIRECT,no-resolve")
    return rules


def tls_fields(node: dict) -> dict:
    tls = node.get("tls") or {}
    if not tls.get("enabled"):
        return {}
    result = {"tls": True}
    if tls.get("server_name"):
        result["servername"] = tls["server_name"]
    if tls.get("insecure"):
        result["skip-cert-verify"] = True
    reality = tls.get("reality") or {}
    if reality.get("enabled"):
        result["reality-opts"] = {
            "public-key": reality.get("public_key", ""),
            "short-id": reality.get("short_id", ""),
        }
    return result


def transport_fields(node: dict) -> dict:
    transport = node.get("transport") or {}
    kind = transport.get("type")
    if kind == "ws":
        result = {"network": "ws"}
        if transport.get("path"):
            result["ws-opts"] = {"path": transport["path"]}
            headers = transport.get("headers") or {}
            if headers:
                result["ws-opts"]["headers"] = headers
        return result
    if kind == "grpc":
        return {"network": "grpc", "grpc-opts": {"grpc-service-name": transport.get("service_name", "")}}
    if kind == "http":
        return {"network": "h2", "h2-opts": {"path": transport.get("path", ""), "host": transport.get("host", [])}}
    return {}


def convert(node: dict) -> dict | None:
    typ = node.get("type")
    if typ in {"direct", "block", "selector", "urltest", "dns"}:
        return None
    result = {"name": node.get("tag") or node.get("server") or typ, "type": typ}
    result["server"] = node.get("server", "")
    result["port"] = int(node.get("server_port", 443))
    if typ == "vmess":
        result.update({"uuid": node.get("uuid", ""), "alterId": int(node.get("alter_id", 0)), "cipher": node.get("security", "auto")})
    elif typ == "vless":
        result["uuid"] = node.get("uuid", "")
        if node.get("flow"):
            result["flow"] = node["flow"]
    elif typ == "trojan":
        result["password"] = node.get("password", "")
    elif typ == "shadowsocks":
        result.update({"cipher": node.get("method", ""), "password": node.get("password", "")})
    elif typ == "hysteria2":
        result["password"] = node.get("password", "")
    else:
        return None
    result.update(tls_fields(node))
    result.update(transport_fields(node))
    return result


def main() -> None:
    values = conf(Path(os.environ.get("ROUTER_CONF", "/etc/bypassproxy/router.conf")))
    source = Path(os.environ.get("OUTBOUNDS_JSON", "/etc/bypassproxy/outbounds.json"))
    target = Path(os.environ.get("OUTPUT", "/etc/mihomo/config.yaml"))
    custom_rules_path = Path(
        os.environ.get(
            "CUSTOM_RULES_JSON",
            values.get("CUSTOM_RULES_JSON", "/etc/bypassproxy/custom-rules.json"),
        )
    )
    raw = json.loads(source.read_text(encoding="utf-8-sig"))
    nodes = raw.get("outbounds", []) if isinstance(raw, dict) else raw
    converted = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        item = convert(node)
        if item:
            converted.append((item, str(node.get("_subscription") or "").strip()))
    proxies = [item for item, _subscription in converted]
    if not proxies:
        raise SystemExit("没有可转换的 mihomo 节点")
    names = [item["name"] for item in proxies]
    auto_group = "自动选择"
    groups = [{"name": auto_group, "type": "url-test", "url": "https://www.gstatic.com/generate_204", "interval": 300, "tolerance": 50, "proxies": names}]
    subscription_groups = []
    grouped: dict[str, list[str]] = {}
    for item, subscription in converted:
        if subscription:
            grouped.setdefault(subscription, []).append(item["name"])
    for subscription, group_names in grouped.items():
        group_name = f"订阅 - {subscription}"
        groups.append({"name": group_name, "type": "select", "proxies": group_names, "default": group_names[0]})
        subscription_groups.append(group_name)
    # Keep subscription groups visible for browsing, but expose real nodes in
    # PROXY as well. mihomo cannot reliably select a nested group through its
    # REST API, while it can always select a concrete proxy name.
    groups.append({"name": "PROXY", "type": "select", "proxies": [auto_group, *names], "default": auto_group})
    custom_rules = load_custom_rules(custom_rules_path)
    config = {
        "mixed-port": int(values.get("PROXY_PORT", "7890")),
        "listeners": [
            {
                "name": "speed-test-in",
                "type": "mixed",
                "port": int(values.get("SPEED_TEST_PORT", "7891")),
                "listen": "127.0.0.1",
                "udp": True,
                "proxy": "PROXY",
            }
        ],
        "allow-lan": True,
        "bind-address": "*",
        "mode": "Rule",
        "log-level": "info",
        "external-controller": f"0.0.0.0:{values.get('PANEL_PORT', '9091')}",
        "secret": values.get("PANEL_SECRET", "abc123"),
        # Keep the UI below mihomo's -d directory; absolute paths outside it are rejected.
        "external-ui": "ui",
        "ipv6": False,
        "dns": {
            "enable": True,
            "enhanced-mode": "fake-ip",
            "nameserver": [values.get("DNS1", "223.5.5.5"), values.get("DNS2", "119.29.29.29")],
            "fake-ip-filter": ["*.lan", "localhost.ptlogin2.qq.com", "+.in-addr.arpa", "+.ip6.arpa"],
        },
        "tun": {"enable": values.get("TUN_ENABLE", "1") not in {"0", "false", "off"}, "stack": "system", "device": values.get("TUN_NAME", "sbtun0"), "auto-route": True, "auto-detect-interface": True, "dns-hijack": ["any:53"]},
        "proxies": proxies,
        "proxy-groups": groups,
        "rules": [
            *build_rules(custom_rules),
            "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
            "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
            "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
            "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
            "GEOSITE,CN,DIRECT",
            "GEOIP,CN,DIRECT,no-resolve",
            "MATCH,PROXY",
        ],
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(target)


if __name__ == "__main__":
    main()
