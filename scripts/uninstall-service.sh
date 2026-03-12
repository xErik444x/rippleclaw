#!/usr/bin/env bash
set -euo pipefail

SERVICE_DST="/etc/systemd/system/rippleclaw.service"
WRAPPER_DST="/usr/local/bin/rippleclaw"

echo "Stopping and removing RippleClaw systemd service..."
sudo systemctl stop rippleclaw || true
sudo systemctl disable rippleclaw || true

if [[ -f "$SERVICE_DST" ]]; then
  sudo rm -f "$SERVICE_DST"
fi
if [[ -f "$WRAPPER_DST" ]]; then
  sudo rm -f "$WRAPPER_DST"
fi

sudo systemctl daemon-reload
echo "✅ Removed rippleclaw.service"
