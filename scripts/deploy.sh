#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-chordfiddle}"
REMOTE_DIR="${DEPLOY_DIR:-ChordFiddle}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and fill in values first." >&2
  exit 1
fi

if [[ ! -f service-account.json ]]; then
  echo "Missing service-account.json in project root." >&2
  exit 1
fi

echo "Syncing to ${HOST}:~/${REMOTE_DIR} ..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude .env \
  --exclude service-account.json \
  --exclude 'client_secret*' \
  --exclude 'stupid-song*' \
  --exclude '.DS_Store' \
  ./ "${HOST}:~/${REMOTE_DIR}/"

echo "Copying secrets ..."
scp .env service-account.json "${HOST}:~/${REMOTE_DIR}/"

echo "Building and restarting on ${HOST} ..."
ssh "${HOST}" bash <<REMOTE
set -euo pipefail
source ~/.nvm/nvm.sh
cd ~/${REMOTE_DIR}
grep -q '^PORT=' .env || echo 'PORT=9000' >> .env
corepack enable
yarn install
yarn build

PLIST=~/Library/LaunchAgents/com.chordfiddle.app.plist
if [[ -f scripts/com.chordfiddle.plist ]]; then
  mkdir -p ~/Library/LaunchAgents
  cp scripts/com.chordfiddle.plist "\$PLIST"
  launchctl bootout "gui/\$(id -u)" "\$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/\$(id -u)" "\$PLIST"
  launchctl enable "gui/\$(id -u)/com.chordfiddle.app"
  launchctl kickstart -k "gui/\$(id -u)/com.chordfiddle.app"
else
  pkill -f "node server/index.js" 2>/dev/null || true
  nohup yarn start:prod > /tmp/chordfiddle.log 2>&1 &
fi

sleep 2
PORT=\$(grep '^PORT=' .env | cut -d= -f2)
curl -fsS "http://127.0.0.1:\${PORT}/api/health" && echo ""
REMOTE

echo ""
echo "Deployed. Open http://192.168.1.22:9000 on your LAN (or the PORT in remote .env)."
echo "Add that URL to Google OAuth authorized JavaScript origins if sign-in fails."
