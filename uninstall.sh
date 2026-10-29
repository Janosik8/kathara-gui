#!/bin/sh
# Removes the kathara-gui command installed by install.sh (bug 38, F45).
#
# Only the command goes. Labs in kathara-labs folders stay, and so do uv,
# Node.js and Docker, which may serve other things: this never removes system
# software, as install.sh never installs it.
cd "$(dirname "$0")"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed, so neither is kathara-gui: it is installed with uv."
  echo "Nothing to remove."
  exit 0
fi
if ! uv tool list 2>/dev/null | grep -q "^kathara-gui "; then
  echo "kathara-gui is not installed. Nothing to remove."
  exit 0
fi

echo "Removing the kathara-gui command..."
if ! uv tool uninstall kathara-gui; then
  echo
  echo "Removal stopped: uv could not remove it. If kathara-gui is running, stop it"
  echo "with Ctrl+C in its terminal, then run ./uninstall.sh again."
  exit 1
fi

echo
echo "Removed. Kept, on purpose:"
echo "  - your labs, in the kathara-labs folders where you started kathara-gui;"
echo "  - any lab still deployed: its containers run on in Docker. Stop them with"
echo "    \"Stop every lab\" before uninstalling."
echo "  - uv, Node.js and Docker, which you may use for other things."
echo "This project folder can now be deleted. To install again, run ./install.sh."
