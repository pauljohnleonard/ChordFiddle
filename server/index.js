const path = require('path');
const express = require('express');
const cors = require('cors');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { requireUser } = require('./auth');
const {
  getRootFolderId,
  listAllFolderContents,
  getFileMetadata,
  downloadSongContent,
  uploadSongContent,
  userCanEditFolder,
} = require('./drive');

const app = express();
const port = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.text({ type: '*/*', limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    driveConfigured: Boolean(getRootFolderId()),
  });
});

app.get('/api/folders/:folderId/contents', async (req, res) => {
  try {
    const folderId = req.params.folderId === 'root' ? getRootFolderId() : req.params.folderId;
    if (!folderId) {
      res.status(500).json({ error: 'DRIVE_FOLDER_ID is not configured on the server' });
      return;
    }

    const contents = await listAllFolderContents(folderId);
    res.json(contents);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to list folder' });
  }
});

app.get('/api/songs/:fileId', async (req, res) => {
  try {
    const metadata = await getFileMetadata(req.params.fileId);
    const content = await downloadSongContent(metadata);
    res.json({ file: metadata, content });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load song' });
  }
});

app.get('/api/me', requireUser, async (req, res) => {
  try {
    const canEdit = await userCanEditFolder(req.user.email);
    res.json({
      email: req.user.email,
      canEdit,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to check permissions' });
  }
});

app.put('/api/songs/:fileId', requireUser, async (req, res) => {
  try {
    const canEdit = await userCanEditFolder(req.user.email);
    if (!canEdit) {
      res.status(403).json({ error: 'You need Editor access on the song library folder' });
      return;
    }

    const metadata = await getFileMetadata(req.params.fileId);
    await uploadSongContent(metadata, req.body);
    res.json({ ok: true, file: metadata });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to save song' });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Song library API listening on http://localhost:${port}`);
});
