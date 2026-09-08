#!/bin/sh
set -eu

/usr/local/bin/prepare-openmausbot-workspace.sh
attempt=0
until DISPLAY=:1 xset q >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 45 ]; then
    echo "X display :1 did not become ready within 45 seconds" >&2
    exit 1
  fi
  sleep 1
done

if command -v ibus-daemon >/dev/null 2>&1; then
  ibus-daemon --daemonize --replace --xim || true
fi

exec env \
  CUA_DRIVER_INSTALL_CHANNEL=python_package \
  CUA_DRIVER_RS_TELEMETRY_ENABLED=0 \
  /usr/local/libexec/openmausbot/cua-driver serve \
  --socket /run/user/1000/openmausbot-cua.sock \
  --permission-mode standard
