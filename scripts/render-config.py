#!/usr/bin/env python3
import ipaddress
import json
import os
import re
import shlex
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
INTERNAL_OUTBOUND_KEYS = {"_subscription", "_subscription_id"}


def load_conf(path: Path) -> dict:
    values = {}
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = parse_conf_value(value.strip())
    return values


def parse_conf_value(value: str) -> str:
    try:
        parts = shlex.split(value, comments=False, posix=True)
    except ValueError:
        return value
    if len(parts) == 1:
        return parts[0]
    return value


def unique_reserved_tag(base: str, used: set[str]) -> str:
    tag = base
    index = 2
    while tag in used:
        tag = f"{base} {index}"
        index += 1
    used.add(tag)
    return tag


INFORMATION_TAG_PATTERNS = (
    r"^(?:剩余流量|流量剩余|套餐到期|距离下次重置|下次重置|到期时间|有效期)",
    r"^(?:建议|公告|通知|使用说明|使用须知)[：:]",
    r"官网.*https?://",
)


def is_information_outbound(raw: dict) -> bool:
    tag = str(raw.get("tag") or "").strip()
    return bool(tag and any(re.search(pattern, tag, re.IGNORECASE) for pattern in INFORMATION_TAG_PATTERNS))


def prepare_proxy_outbounds(data: list[dict]) -> list[tuple[dict, dict]]:
    reserved = {"auto", "proxy", "direct", "block"}
    used = set(reserved)
    prepared = []
    for raw in data:
        if raw.get("type") in {"direct", "block"} or is_information_outbound(raw):
            continue
        item = {key: value for key, value in raw.items() if key not in INTERNAL_OUTBOUND_KEYS}
        tag = str(item.get("tag") or item.get("server") or item.get("type") or "proxy").strip()
        item["tag"] = unique_reserved_tag(tag, used)
        prepared.append((raw, item))
    return prepared



CUSTOM_RULE_KEYS = {
    "proxy_domains": "proxy",
    "proxy_ips": "proxy",
    "direct_domains": "direct",
    "direct_ips": "direct",
}


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


def normalize_ip_cidr(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    try:
        return str(ipaddress.ip_network(value, strict=False))
    except ValueError:
        return ""


def clean_rule_values(values, kind: str) -> list[str]:
    result = []
    seen = set()
    normalizer = normalize_ip_cidr if kind == "ip" else normalize_domain
    if not isinstance(values, list):
        return result
    for raw in values:
        value = normalizer(str(raw))
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def load_custom_route_rules(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise SystemExit(f"自定义分流规则读取失败：{exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("自定义分流规则必须是 JSON 对象")

    proxy_domains = clean_rule_values(data.get("proxyDomains") or data.get("proxy_domains"), "domain")
    proxy_ips = clean_rule_values(data.get("proxyIps") or data.get("proxy_ips"), "ip")
    direct_domains = clean_rule_values(data.get("directDomains") or data.get("direct_domains"), "domain")
    direct_ips = clean_rule_values(data.get("directIps") or data.get("direct_ips"), "ip")

    rules = []
    if proxy_domains:
        rules.append({"domain_suffix": proxy_domains, "outbound": "proxy"})
    if proxy_ips:
        rules.append({"ip_cidr": proxy_ips, "outbound": "proxy"})
    if direct_domains:
        rules.append({"domain_suffix": direct_domains, "outbound": "direct"})
    if direct_ips:
        rules.append({"ip_cidr": direct_ips, "outbound": "direct"})
    return rules


def insert_custom_route_rules(config: dict, custom_rules: list[dict]) -> None:
    if not custom_rules:
        return
    route = config.get("route")
    if not isinstance(route, dict):
        raise SystemExit("配置模板缺少 route 对象")
    rules = route.get("rules")
    if not isinstance(rules, list):
        raise SystemExit("配置模板缺少 route.rules 列表")
    insert_at = 0
    while insert_at < len(rules) and isinstance(rules[insert_at], dict):
        rule = rules[insert_at]
        if rule.get("action") not in {"hijack-dns", "sniff"} and not rule.get("clash_mode"):
            break
        insert_at += 1
    rules[insert_at:insert_at] = custom_rules


def is_enabled(value: str) -> bool:
    return str(value).strip().lower() not in {"0", "false", "off", "no", "disable", "disabled", "关", "关闭"}


def apply_tun_switch(config: dict, enabled: bool) -> None:
    if enabled:
        return
    inbounds = config.get("inbounds")
    if not isinstance(inbounds, list):
        raise SystemExit("配置模板缺少 inbounds 列表")
    config["inbounds"] = [item for item in inbounds if not (isinstance(item, dict) and item.get("type") == "tun")]


def subscription_display_name(name: str, sub_id: str) -> str:
    name = name.strip()
    if "://" in name:
        parsed = urlsplit(name)
        name = parsed.hostname or parsed.path.strip("/")
    return name or f"订阅 {sub_id}"


def group_tags(prepared: list[tuple[dict, dict]]) -> list[tuple[str, str, list[str]]]:
    groups = []
    by_key = {}
    for raw, item in prepared:
        name = str(raw.get("_subscription") or "").strip()
        sub_id = str(raw.get("_subscription_id") or name).strip()
        if not name:
            continue
        key = sub_id or name
        if key not in by_key:
            by_key[key] = {"name": subscription_display_name(name, sub_id), "tags": []}
            groups.append(key)
        by_key[key]["tags"].append(item["tag"])
    return [(key, by_key[key]["name"], by_key[key]["tags"]) for key in groups]


def load_outbounds(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, dict):
        data = data.get("outbounds", [])
    if not isinstance(data, list):
        raise SystemExit("outbounds.json 必须是 JSON 列表，或包含 outbounds 字段的对象")
    prepared = prepare_proxy_outbounds(data)
    proxies = [item for _raw, item in prepared]
    tags = [item["tag"] for item in proxies]
    if not tags:
        raise SystemExit("outbounds.json has no proxy outbounds")
    generated = []
    generated_used = set(tags)
    auto_tag = unique_reserved_tag("auto", generated_used)
    generated.append(
        {
            "type": "urltest",
            "tag": auto_tag,
            "outbounds": tags,
            "url": "https://www.gstatic.com/generate_204",
            "interval": "10m",
            "tolerance": 50,
        }
    )
    subscription_selectors = []
    for _sub_id, name, sub_tags in group_tags(prepared):
        group_selector_tag = unique_reserved_tag(f"订阅 - {name}", generated_used)
        generated.append(
            {
                "type": "selector",
                "tag": group_selector_tag,
                "outbounds": sub_tags,
                "default": sub_tags[0],
            }
        )
        subscription_selectors.append(group_selector_tag)
    generated = [
        *generated,
        {"type": "selector", "tag": "proxy", "outbounds": [auto_tag] + subscription_selectors, "default": auto_tag},
        {"type": "direct", "tag": "direct"},
        {"type": "block", "tag": "block"},
    ] + proxies
    return ",\n    ".join(json.dumps(item, ensure_ascii=False, indent=4) for item in generated)


def main() -> None:
    conf_path = Path(os.environ.get("ROUTER_CONF", ROOT / "router.conf"))
    outbounds_path = Path(os.environ.get("OUTBOUNDS_JSON", ROOT / "secrets" / "outbounds.json"))
    out_path = Path(os.environ.get("OUTPUT", ROOT / "build" / "config.json"))

    if not conf_path.exists():
        raise SystemExit(f"缺少 {conf_path}；请先创建 router.conf")
    if not outbounds_path.exists():
        raise SystemExit(f"缺少 {outbounds_path}；请先配置订阅或节点")

    values = {
        "LAN_IF": "enp3s0",
        "LAN_NET": "192.168.3.0/24",
        "LAN_IP": "192.168.3.88",
        "PROXY_PORT": "7890",
        "PANEL_PORT": "9091",
        "PANEL_SECRET": "abc123",
        "TUN_ENABLE": "1",
        "TUN_NAME": "sbtun0",
        "TUN_ADDRESS": "28.0.0.1/30",
        "DNS1": "223.5.5.5",
        "DNS2": "119.29.29.29",
    }
    values.update(load_conf(conf_path))
    template = (ROOT / "templates" / "sing-box.template.json").read_text(encoding="utf-8")
    values["OUTBOUNDS"] = load_outbounds(outbounds_path)

    for key, value in values.items():
        template = template.replace("{{" + key + "}}", value)

    unresolved = [part.split("}}", 1)[0] for part in template.split("{{")[1:]]
    if unresolved:
        raise SystemExit(f"模板里还有未解析的配置项：{', '.join(sorted(set(unresolved)))}")

    config = json.loads(template)
    apply_tun_switch(config, is_enabled(values.get("TUN_ENABLE", "1")))
    custom_rules_path = Path(os.environ.get("CUSTOM_RULES_JSON", values.get("CUSTOM_RULES_JSON", "/etc/bypassproxy/custom-rules.json")))
    insert_custom_route_rules(config, load_custom_route_rules(custom_rules_path))
    rendered = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(rendered, encoding="utf-8")
    print(out_path)


if __name__ == "__main__":
    main()
