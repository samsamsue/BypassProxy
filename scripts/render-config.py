#!/usr/bin/env python3
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_conf(path: Path) -> dict:
    values = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def load_outbounds(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("outbounds", [])
    if not isinstance(data, list):
        raise SystemExit("outbounds.json must be a JSON list or object with outbounds")
    tags = [item["tag"] for item in data if item.get("type") not in {"direct", "block"}]
    if not tags:
        raise SystemExit("outbounds.json has no proxy outbounds")
    generated = [
        {"type": "selector", "tag": "proxy", "outbounds": tags, "default": tags[0]},
        {
            "type": "urltest",
            "tag": "auto",
            "outbounds": tags,
            "url": "https://www.gstatic.com/generate_204",
            "interval": "10m",
            "tolerance": 50,
        },
        {"type": "direct", "tag": "direct"},
        {"type": "block", "tag": "block"},
    ] + data
    return ",\n    ".join(json.dumps(item, ensure_ascii=False, indent=4) for item in generated)


def main() -> None:
    conf_path = Path(os.environ.get("ROUTER_CONF", ROOT / "router.conf"))
    outbounds_path = Path(os.environ.get("OUTBOUNDS_JSON", ROOT / "secrets" / "outbounds.json"))
    out_path = Path(os.environ.get("OUTPUT", ROOT / "build" / "config.json"))

    if not conf_path.exists():
        raise SystemExit(f"missing {conf_path}; copy router.conf.example to router.conf")
    if not outbounds_path.exists():
        raise SystemExit(f"missing {outbounds_path}; create it from your sing-box proxy outbounds")

    values = load_conf(conf_path)
    template = (ROOT / "templates" / "sing-box.template.json").read_text(encoding="utf-8")
    values["OUTBOUNDS"] = load_outbounds(outbounds_path)

    for key, value in values.items():
        template = template.replace("{{" + key + "}}", value)

    unresolved = [part.split("}}", 1)[0] for part in template.split("{{")[1:]]
    if unresolved:
        raise SystemExit(f"unresolved template values: {', '.join(sorted(set(unresolved)))}")

    json.loads(template)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(template, encoding="utf-8")
    print(out_path)


if __name__ == "__main__":
    main()
