#!/usr/bin/env python3
import json
import os
import shlex
from pathlib import Path


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


def clean_proxy_outbounds(data: list[dict]) -> list[dict]:
    reserved = {"auto", "proxy", "direct", "block"}
    used = set(reserved)
    cleaned = []
    for raw in data:
        if raw.get("type") in {"direct", "block"}:
            continue
        item = {key: value for key, value in raw.items() if key not in INTERNAL_OUTBOUND_KEYS}
        tag = str(item.get("tag") or item.get("server") or item.get("type") or "proxy").strip()
        item["tag"] = unique_reserved_tag(tag, used)
        cleaned.append(item)
    return cleaned


def group_tags(original: list[dict], cleaned: list[dict]) -> list[tuple[str, str, list[str]]]:
    groups = []
    by_key = {}
    proxy_original = [item for item in original if item.get("type") not in {"direct", "block"}]
    for raw, item in zip(proxy_original, cleaned):
        name = str(raw.get("_subscription") or "").strip()
        sub_id = str(raw.get("_subscription_id") or name).strip()
        if not name:
            continue
        key = sub_id or name
        if key not in by_key:
            by_key[key] = {"name": name, "tags": []}
            groups.append(key)
        by_key[key]["tags"].append(item["tag"])
    return [(key, by_key[key]["name"], by_key[key]["tags"]) for key in groups]


def load_outbounds(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, dict):
        data = data.get("outbounds", [])
    if not isinstance(data, list):
        raise SystemExit("outbounds.json 必须是 JSON 列表，或包含 outbounds 字段的对象")
    proxies = clean_proxy_outbounds(data)
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
    for _sub_id, name, sub_tags in group_tags(data, proxies):
        group_auto_tag = unique_reserved_tag(f"自动测速 - {name}", generated_used)
        group_selector_tag = unique_reserved_tag(f"订阅 - {name}", generated_used)
        generated.append(
            {
                "type": "urltest",
                "tag": group_auto_tag,
                "outbounds": sub_tags,
                "url": "https://www.gstatic.com/generate_204",
                "interval": "10m",
                "tolerance": 50,
            }
        )
        generated.append(
            {
                "type": "selector",
                "tag": group_selector_tag,
                "outbounds": [group_auto_tag] + sub_tags,
                "default": group_auto_tag,
            }
        )
        subscription_selectors.append(group_selector_tag)
    generated = [
        *generated,
        {"type": "selector", "tag": "proxy", "outbounds": [auto_tag] + subscription_selectors + tags, "default": auto_tag},
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

    json.loads(template)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(template, encoding="utf-8")
    print(out_path)


if __name__ == "__main__":
    main()
