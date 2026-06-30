#!/bin/sh
set -eu

case "${1:-}" in
  status)
    systemctl --no-pager --full status sing-box
    ;;
  restart)
    sing-box check -C /etc/sing-box
    systemctl restart sing-box
    ;;
  logs)
    journalctl -u sing-box -f
    ;;
  check)
    sing-box check -C /etc/sing-box
    ;;
  apply-forward)
    /usr/local/sbin/home-lan-bypass-forward.sh
    ;;
  *)
    echo "usage: $0 {status|restart|logs|check|apply-forward}" >&2
    exit 2
    ;;
esac
