#!/usr/bin/env bash
# Disable macOS built-in Apache so only Homebrew httpd serves port 80/443.
# Run on the iMac with a TTY:
#   ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/disable-system-apache.sh'

set -euo pipefail

SYSTEM_APACHECTL="/usr/sbin/apachectl"
SYSTEM_OTHER="/private/etc/apache2/other"
SYSTEM_PLIST="/System/Library/LaunchDaemons/org.apache.httpd.plist"
BREW_APACHECTL="/usr/local/bin/apachectl"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=reload-brew-httpd.sh
source "${SCRIPT_DIR}/reload-brew-httpd.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS." >&2
  exit 1
fi

if ! [[ -t 0 ]]; then
  echo "Run with a TTY so sudo can prompt for your password:" >&2
  echo "  ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/disable-system-apache.sh'" >&2
  exit 1
fi

echo "Stopping macOS system Apache ..."
if sudo "${SYSTEM_APACHECTL}" -k stop 2>/dev/null; then
  echo "System httpd stopped."
else
  echo "System httpd was not running (or already stopped)."
fi

if [[ -f "${SYSTEM_PLIST}" ]]; then
  echo "Disabling org.apache.httpd launchd job (survives reboot) ..."
  sudo launchctl bootout system/org.apache.httpd 2>/dev/null || true
  sudo launchctl unload -w "${SYSTEM_PLIST}" 2>/dev/null || true
fi

echo "Archiving site configs in ${SYSTEM_OTHER} ..."
for file in orgbrain.conf speakkit.conf cheese-jam.conf; do
  if [[ -f "${SYSTEM_OTHER}/${file}" ]]; then
    sudo mv "${SYSTEM_OTHER}/${file}" "${SYSTEM_OTHER}/${file}.disabled-by-chordfiddle"
    echo "  moved ${file} → ${file}.disabled-by-chordfiddle"
  fi
done

echo ""
echo "Ensuring Homebrew httpd is running ..."
reload_brew_httpd

echo ""
echo "Listeners on port 80/443 (should only be Homebrew httpd):"
sudo lsof -nP -iTCP:80 -sTCP:LISTEN 2>/dev/null || true
sudo lsof -nP -iTCP:443 -sTCP:LISTEN 2>/dev/null || true

echo ""
echo "Homebrew vhosts:"
"${BREW_APACHECTL}" -S 2>&1 | grep -E "port 80|port 443|namevhost" || true

echo ""
echo "Done. macOS system Apache is stopped and disabled."
echo "All sites are served by Homebrew httpd — see scripts/apache/README.md"
