#!/usr/bin/env bash
# Open a shell on the ChordFiddle iMac (uses ~/.ssh/config host "chordfiddle").
set -euo pipefail

HOST="${DEPLOY_HOST:-chordfiddle}"
REMOTE_DIR="${DEPLOY_DIR:-ChordFiddle}"

exec ssh -t "${HOST}" "export PATH=\"\$HOME/.nvm/versions/node/v20.18.1/bin:/usr/local/bin:\$PATH\"; cd ~/${REMOTE_DIR}; exec bash -l"
