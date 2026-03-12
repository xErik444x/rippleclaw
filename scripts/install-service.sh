#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_SRC="$ROOT_DIR/rippleclaw.service"
SERVICE_DST="/etc/systemd/system/rippleclaw.service"
WRAPPER_DST="/usr/local/bin/rippleclaw"

NVMRC_PATH="$ROOT_DIR/.nvmrc"
ASDF_TOOL_VERSIONS="$ROOT_DIR/.tool-versions"
VOLTA_HOME_DEFAULT="$HOME/.volta"
ASDF_DIR_DEFAULT="$HOME/.asdf"

EXEC_START="/usr/bin/node $ROOT_DIR/dist/daemon.js"

if [[ -f "$ROOT_DIR/package.json" ]] && (command -v volta >/dev/null 2>&1 || [[ -x "$VOLTA_HOME_DEFAULT/bin/volta" ]]); then
  EXEC_START="/bin/bash -lc 'export VOLTA_HOME=\"$VOLTA_HOME_DEFAULT\"; export PATH=\"$VOLTA_HOME/bin:\$PATH\"; exec node \"$ROOT_DIR/dist/daemon.js\"'"
  echo "Detected Volta. Using Volta-managed Node."
elif [[ -f "$NVMRC_PATH" ]]; then
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    EXEC_START="/bin/bash -lc 'export NVM_DIR=\"$NVM_DIR\"; . \"$NVM_DIR/nvm.sh\"; nvm use --silent; exec node \"$ROOT_DIR/dist/daemon.js\"'"
    echo "Detected NVM (.nvmrc). Using NVM-managed Node."
  fi
elif [[ -f "$ASDF_TOOL_VERSIONS" ]]; then
  if grep -q '^nodejs ' "$ASDF_TOOL_VERSIONS"; then
    if [[ -s "$ASDF_DIR_DEFAULT/asdf.sh" ]]; then
      EXEC_START="/bin/bash -lc '. \"$ASDF_DIR_DEFAULT/asdf.sh\"; asdf exec node \"$ROOT_DIR/dist/daemon.js\"'"
      echo "Detected asdf (.tool-versions). Using asdf-managed Node."
    fi
  fi
fi

if [[ ! -f "$SERVICE_SRC" ]]; then
  echo "Service file not found: $SERVICE_SRC"
  exit 1
fi

echo "Installing RippleClaw systemd service..."
sudo cp "$SERVICE_SRC" "$SERVICE_DST"

# Patch WorkingDirectory/ExecStart to match current install path
sudo sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$ROOT_DIR|g" "$SERVICE_DST"
sudo sed -i "s|^ExecStart=.*|ExecStart=$EXEC_START|g" "$SERVICE_DST"

sudo systemctl daemon-reload
sudo systemctl enable rippleclaw
sudo systemctl restart rippleclaw

echo "Installing rippleclaw wrapper..."
sudo tee "$WRAPPER_DST" >/dev/null <<EOF
#!/usr/bin/env bash
set -euo pipefail

SERVICE="rippleclaw"
ROOT="$ROOT_DIR"

case "\${1:-}" in
  cli)
    shift
    exec node "\$ROOT/dist/daemon.js" --channel cli "\$@"
    ;;
  logs)
    exec sudo journalctl -u "\$SERVICE" -f
    ;;
  status)
    exec systemctl status "\$SERVICE" --no-pager
    ;;
  restart)
    exec sudo systemctl restart "\$SERVICE"
    ;;
  start)
    exec sudo systemctl start "\$SERVICE"
    ;;
  stop)
    exec sudo systemctl stop "\$SERVICE"
    ;;
  *)
    echo "Usage: rippleclaw {cli|logs|status|restart|start|stop}"
    exit 1
    ;;
esac
EOF
sudo chmod +x "$WRAPPER_DST"

echo "✅ Installed and started rippleclaw.service"
sudo systemctl status rippleclaw --no-pager
