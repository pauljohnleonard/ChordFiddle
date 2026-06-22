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

### 3. OAuth client (sign-in only)

Same OAuth client as before, but scopes are only **email / profile** — no Drive scope in the browser.

**Authorized JavaScript origins:** `http://localhost:9000`

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

1. User signs in with Google (email only — no scary Drive prompt)
2. Server checks Drive folder permissions for that email
3. If they are **Editor** or **Owner** on the folder (via Drive **Add people**), save is allowed
4. Server writes the file using the service account

## API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/health` | No | Health check |
| `GET /api/folders/:id/contents` | No | List folder (`root` = `DRIVE_FOLDER_ID`) |
| `GET /api/songs/:fileId` | No | Load song |
| `GET /api/me` | Bearer token | Current user + `canEdit` |
| `PUT /api/songs/:fileId` | Bearer token | Save song (editors only) |
