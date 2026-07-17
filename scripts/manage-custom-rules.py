#!/usr/bin/env python3
import ipaddress
import json
import os
import re
from pathlib import Path

RULES_PATH = Path(os.environ.get("CUSTOM_RULES_JSON", "/etc/bypassproxy/custom-rules.json"))
RULE_KEYS = {
    "1": ("directDomains", "直连域名", "domain"),
    "2": ("directIps", "直连 IP/CIDR", "ip"),
    "3": ("proxyDomains", "强制代理域名", "domain"),
    "4": ("proxyIps", "强制代理 IP/CIDR", "ip"),
}


def empty_rules():
    return {"directDomains": [], "directIps": [], "proxyDomains": [], "proxyIps": []}


def normalize_domain(value: str) -> str:
    value = str(value or "").strip().lower()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = re.split(r"[/?#]", value, maxsplit=1)[0]
    value = value.split(":", 1)[0]
    value = value.lstrip("*.").strip(".")
    if not value or any(char.isspace() for char in value):
        raise ValueError("域名格式无效")
    return value


def normalize_ip(value: str) -> str:
    return str(ipaddress.ip_network(str(value).strip(), strict=False))


def load_rules():
    if not RULES_PATH.exists():
        return empty_rules()
    data = json.loads(RULES_PATH.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        return empty_rules()
    rules = empty_rules()
    for key in rules:
        values = data.get(key, [])
        if isinstance(values, list):
            rules[key] = [str(item).strip() for item in values if str(item).strip()]
    return rules


def save_rules(rules):
    RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    RULES_PATH.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        RULES_PATH.chmod(0o600)
    except OSError:
        pass


def show_rules(rules):
    print("\n自定义分流规则：")
    for key, label, _kind in RULE_KEYS.values():
        print(f"\n{label}：")
        values = rules.get(key, [])
        if values:
            for index, value in enumerate(values, 1):
                print(f"  {index}) {value}")
        else:
            print("  暂无")


def add_rule(rules, choice):
    key, label, kind = RULE_KEYS[choice]
    value = input(f"请输入{label}: ").strip()
    if not value:
        print("已取消。")
        return
    try:
        value = normalize_ip(value) if kind == "ip" else normalize_domain(value)
    except Exception as exc:
        print(f"格式无效：{exc}")
        return
    if value in rules[key]:
        print("已存在。")
        return
    rules[key].append(value)
    save_rules(rules)
    print(f"已添加：{value}")


def delete_rule(rules):
    show_rules(rules)
    print("\n删除格式：类型编号 序号，例如 1 2")
    raw = input("请输入要删除的规则: ").strip()
    if not raw:
        print("已取消。")
        return
    parts = raw.split()
    if len(parts) != 2 or parts[0] not in RULE_KEYS:
        print("输入无效。")
        return
    key, label, _kind = RULE_KEYS[parts[0]]
    try:
        index = int(parts[1]) - 1
        value = rules[key][index]
    except Exception:
        print("序号无效。")
        return
    del rules[key][index]
    save_rules(rules)
    print(f"已删除 {label}: {value}")


def main():
    while True:
        rules = load_rules()
        print("\n自定义分流管理")
        print("================")
        print("1) 添加直连域名")
        print("2) 添加直连 IP/CIDR")
        print("3) 添加强制代理域名")
        print("4) 添加强制代理 IP/CIDR")
        print("5) 查看规则")
        print("6) 删除规则")
        print("7) 返回")
        choice = input("请选择: ").strip()
        if choice in {"1", "2", "3", "4"}:
            add_rule(rules, choice)
        elif choice == "5":
            show_rules(rules)
        elif choice == "6":
            delete_rule(rules)
        elif choice in {"7", "q", "Q"}:
            return
        else:
            print("无效选择。")
        input("\n按回车继续...")


if __name__ == "__main__":
    main()
