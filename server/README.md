# Song library API

The song browser uses a small Node server so Drive credentials stay off the client.

## One-time setup

### 1. Service account

1. [Google Cloud Console](https://console.cloud.google.com/) → **IAM & Admin** → **Service accounts**
2. **Create service account** (e.g. `chordfiddle-library`)
3. **Keys** → **Add key** → **JSON** → save as `service-account.json` in the project root
4. Copy the service account email (e.g. `chordfiddle-library@project.iam.gserviceaccount.com`)

### 2. Share your Drive folder

1. Open your song library folder in Google Drive
2. **Share** → add the **service account email** as **Editor**
3. Keep **Anyone with the link → Viewer** if you want public browsing via the server

### 3. OAuth client (sign-in + create new songs)

The browser requests **email / profile** plus **`drive.file`** so new songs can be created in your library folder under your Google account (service accounts cannot create files — they have no storage quota).

Browsing and editing existing songs still use the service account on the server.

**Authorized JavaScript origins:** `http://localhost:9000` (and your production URL)

### 4. `.env`

Copy `.env.example` to `.env` and fill in:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json`
- `DRIVE_FOLDER_ID`

## Run

```bash
yarn install
yarn dev
```

This starts the API on port 3001 and the UI on port 9000.

Or run separately:

```bash
yarn start:api
yarn start
```

## Who can save?

1. User signs in with Google (email + limited Drive access for creating new files)
2. Server checks Drive folder permissions for that email
3. If they are **Editor** or **Owner** on the folder (via Drive **Add people**), save is allowed
4. **New songs** are created with the user's Google account (uses their Drive quota)
5. **Updates** to existing songs use the service account

## API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/health` | No | Health check |
| `GET /api/folders/:id/contents` | No | List folder (`root` = `DRIVE_FOLDER_ID`) |
| `GET /api/songs/:fileId` | No | Load song |
| `GET /api/me` | Bearer token | Current user + `canEdit` |
| `PUT /api/songs/:fileId` | Bearer token | Save song (editors only) |
| `GET /api/tags` | No | All tags with song counts (from index) |
| `GET /api/search` | No | Search indexed songs (`q`, `tag`, `key`, `artist`, `scope`, `folderId`) |
| `GET /api/index/status` | No | Index sync status and song count |
| `POST /api/index/rebuild` | Bearer token | Full re-index (editors only) |

## Song index

On startup the server builds a SQLite index under `server/data/` by parsing ChordPro metadata from every song in `DRIVE_FOLDER_ID`. Tags are read from:

- `{tag: Jazz}` / `{tag: slow}` (Songbook Pro — one tag per line, repeatable)
- `{meta: tags slow, waltz}` (ChordPro meta)
- `{keywords: ...}` / `{topic: ...}` (OnSong)
- `{x_sbp_tags: ...}` (SongbookPro)

Saving a song re-parses and updates its index row. Drive Changes are polled on startup and every 15 minutes (`INDEX_SYNC_INTERVAL_MS` to override).

## Deploy to another machine (LAN)

Passwordless SSH to the host (e.g. `chordfiddle` in `~/.ssh/config`), then from your dev machine:

```bash
yarn deploy
```

This builds the frontend locally, rsyncs the project (including `dist/`) to `~/ChordFiddle` on the remote host, copies `.env` and `service-account.json`, runs `yarn install` on the iMac only when `yarn.lock` changes, and installs a macOS LaunchAgent so the app starts on login.

Production serves the built UI and `/api` on one port (default **9000** — set `PORT` in `.env`).

Open `http://<host-ip>:9000` from devices on your LAN.

**Google OAuth:** add `http://192.168.1.22:9000` (or your host IP/port) to **Authorized JavaScript origins** in Google Cloud Console.

Remote logs: `/tmp/chordfiddle.log` and `/tmp/chordfiddle.err`

