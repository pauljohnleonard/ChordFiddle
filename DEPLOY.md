# Deploying ChordFiddle

## Web server on the iMac

Use **Homebrew Apache only** (`brew services start httpd`). Config lives in `/usr/local/etc/httpd/`.

macOS also has a built-in `/usr/sbin/httpd` — it must stay **off** or it steals port 80 and breaks certbot. One-time fix:

```bash
yarn deploy
ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/disable-system-apache.sh'
```

See [scripts/apache/README.md](scripts/apache/README.md) for the full vhost layout (speakkit, orgbrain, cheese-jam).

## App (Node)

```bash
yarn deploy
```

- Syncs to `~/ChordFiddle` on the iMac
- Copies `.env` and `service-account.json`
- Runs on port **9000** via LaunchAgent
- LAN: http://192.168.1.22:9000

```bash
tail -f /tmp/chordfiddle.log
launchctl kickstart -k gui/$(id -u)/com.chordfiddle.app
```

## Apache — cheese-jam.drpjl.com

After disabling system Apache:

```bash
yarn deploy
ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/install-apache.sh'
```

Use `ssh -t` (no heredoc) so sudo works.

Public URL: **https://cheese-jam.drpjl.com**

### Google OAuth

Add to **Authorized JavaScript origins**:

```
https://cheese-jam.drpjl.com
```

### Useful commands

```bash
/usr/local/bin/apachectl -S              # list vhosts
./scripts/reload-brew-httpd.sh           # safe reload (handles stale httpd)
sudo lsof -nP -iTCP:80 -sTCP:LISTEN      # should show only Homebrew httpd
```

If `brew services` shows httpd **error** and install fails with “Address already in use”, run:

```bash
ssh -t chordfiddle 'cd ~/ChordFiddle && ./scripts/reload-brew-httpd.sh'
```

### TLS wildcard `*.drpjl.com` (optional)

```bash
sudo certbot certonly --manual --preferred-challenges dns \
  -d 'drpjl.com' -d '*.drpjl.com'
```

Edit `/usr/local/etc/httpd/extra/cheese-jam.conf` cert paths, then `brew services restart httpd`.
