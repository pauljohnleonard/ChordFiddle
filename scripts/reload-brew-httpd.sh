#!/usr/bin/env bash
# Reload Homebrew httpd safely when brew services and a live httpd disagree.
# Usage: source this file, or run directly:
#   ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/reload-brew-httpd.sh'

set -euo pipefail

APACHECTL="${APACHECTL:-/usr/local/bin/apachectl}"
HTTPD_BIN="/usr/local/opt/httpd/bin/httpd"
PID_FILE="/usr/local/var/run/httpd/httpd.pid"

httpd_is_running() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    kill -0 "${pid}" 2>/dev/null && return 0
  fi
  pgrep -f "${HTTPD_BIN}" >/dev/null 2>&1
}

stop_orphan_httpd() {
  echo "Stopping orphan Homebrew httpd processes ..."
  if [[ -f "${PID_FILE}" ]]; then
    sudo "${APACHECTL}" -k stop 2>/dev/null || true
    sleep 1
  fi
  if pgrep -f "${HTTPD_BIN}" >/dev/null 2>&1; then
    sudo pkill -f "${HTTPD_BIN}" || true
    sleep 1
  fi
}

reload_brew_httpd() {
  echo "Testing Apache configuration ..."
  "${APACHECTL}" configtest

  if httpd_is_running; then
    echo "httpd already running — graceful reload ..."
    sudo "${APACHECTL}" -k graceful
  else
    if sudo lsof -nP -iTCP:80 -sTCP:LISTEN 2>/dev/null | grep -q .; then
      echo "Port 80 in use but brew thinks httpd is down — cleaning up ..."
      stop_orphan_httpd
    fi
    echo "Starting httpd via brew services ..."
    if command -v brew >/dev/null 2>&1; then
      brew services restart httpd
    else
      sudo "${APACHECTL}" -k start
    fi
  fi

  sleep 2

  if ! httpd_is_running; then
    echo "httpd failed to start. Check: brew services list | grep httpd" >&2
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if ! [[ -t 0 ]]; then
    echo "Run with a TTY if sudo is needed:" >&2
    echo "  ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/reload-brew-httpd.sh'" >&2
    exit 1
  fi
  reload_brew_httpd
  echo "OK"
fi
