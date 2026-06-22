# Apache on the iMac (Homebrew only)

Use **one** web server: Homebrew `httpd` (`brew services start httpd`).

macOS also ships `/usr/sbin/httpd` — do **not** use it. It caused certbot 301 errors by binding port 80 alongside Homebrew. Disable it with:

```bash
ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/disable-system-apache.sh'
```

## Layout

| File | Site |
|------|------|
| `extra/httpd-vhosts.conf` | speakkit.co.uk |
| `extra/orgbrain.conf` | paul.orgbrain.ai, servers.paul.orgbrain.ai |
| `extra/cheese-jam.conf` | cheese-jam.drpjl.com → ChordFiddle (:9000) |

Main config: `/usr/local/etc/httpd/httpd.conf`

ACME webroot (Let's Encrypt): `/usr/local/var/www/.well-known/acme-challenge/`

Logs: `/usr/local/var/log/httpd/`

## Commands

```bash
# Status
brew services list | grep httpd
/usr/local/bin/apachectl -S

# Reload after editing a vhost
./scripts/reload-brew-httpd.sh
# or: /usr/local/bin/apachectl configtest && sudo /usr/local/bin/apachectl -k graceful

# Confirm nothing else owns port 80/443
sudo lsof -nP -iTCP:80 -sTCP:LISTEN
sudo lsof -nP -iTCP:443 -sTCP:LISTEN
```

## Add a new site

1. Add `extra/mysite.conf` with `<VirtualHost *:80>` / `*:443`
2. Add `Include .../mysite.conf` to `httpd.conf` (or keep includes grouped at the bottom)
3. `apachectl configtest && brew services restart httpd`

Do **not** add files under `/private/etc/apache2/other/` — that is macOS system Apache.

## ChordFiddle / cheese-jam

```bash
ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/install-apache.sh'
```
