#!/usr/bin/env bash
# Run on the iMac (chordfiddle host) with sudo for cert + Apache reload.
#   ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/install-apache.sh'

set -euo pipefail

DOMAIN="${APACHE_DOMAIN:-cheese-jam.drpjl.com}"
HTTPD_EXTRA="/usr/local/etc/httpd/extra"
HTTPD_CONF="/usr/local/etc/httpd/httpd.conf"
WEBROOT="/usr/local/var/www"
CERTBOT="/usr/local/bin/certbot"
CERT_LIVE="/etc/letsencrypt/live/${DOMAIN}"
APACHECTL="/usr/local/bin/apachectl"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=reload-brew-httpd.sh
source "${SCRIPT_DIR}/reload-brew-httpd.sh"

reload_apache() {
  reload_brew_httpd
}

verify_acme_http() {
  echo "Verifying HTTP ACME path (should print: test) ..."
  echo test | sudo tee "${WEBROOT}/.well-known/acme-challenge/test" >/dev/null
  local body
  body="$(curl -fsS "http://${DOMAIN}/.well-known/acme-challenge/test")" || {
    echo "ACME check failed." >&2
    echo "If you still have macOS system Apache on port 80, run:" >&2
    echo "  ./scripts/disable-system-apache.sh" >&2
    return 1
  }
  if [[ "${body}" != "test" ]]; then
    echo "Unexpected response: ${body}" >&2
    return 1
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for the macOS Apache (Homebrew httpd) host." >&2
  exit 1
fi

if ! [[ -t 0 ]]; then
  echo "Run with a TTY so sudo can prompt for your password:" >&2
  echo "  ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/install-apache.sh'" >&2
  exit 1
fi

echo "Installing Apache vhost for ${DOMAIN} (Homebrew httpd only) ..."

sudo mkdir -p "${WEBROOT}/.well-known/acme-challenge"

if ! grep -q 'extra/cheese-jam.conf' "${HTTPD_CONF}"; then
  echo "Adding Include to ${HTTPD_CONF} ..."
  echo "Include ${HTTPD_EXTRA}/cheese-jam.conf" | sudo tee -a "${HTTPD_CONF}" >/dev/null
fi

if [[ ! -f "${CERT_LIVE}/fullchain.pem" ]]; then
  echo ""
  echo "No TLS certificate yet — installing HTTP-only bootstrap ..."
  sudo cp "${ROOT}/scripts/apache/cheese-jam-bootstrap.conf" "${HTTPD_EXTRA}/cheese-jam.conf"
  reload_apache
  verify_acme_http

  echo ""
  echo "Requesting certificate with certbot ..."
  read -r -p "Email for Let's Encrypt expiry notices: " CERT_EMAIL
  sudo "${CERTBOT}" certonly \
    --webroot -w "${WEBROOT}" \
    -d "${DOMAIN}" \
    --email "${CERT_EMAIL}" \
    --agree-tos \
    --non-interactive
else
  echo "Certificate already exists at ${CERT_LIVE}"
fi

echo "Installing full HTTP + HTTPS config ..."
sudo cp "${ROOT}/scripts/apache/cheese-jam.conf" "${HTTPD_EXTRA}/cheese-jam.conf"
reload_apache

echo ""
echo "Done. Open https://${DOMAIN}"
