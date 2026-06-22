const fs = require('fs');
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
  buildFolderContext,
} = require('./drive');
const songIndex = require('./song-index');
const {
  indexSongFromContent,
  rebuildIndexAsync,
  startBackgroundSync,
} = require('./index-sync');

const app = express();
const port = process.env.PORT || process.env.API_PORT || 9000;
const distPath = path.join(__dirname, '..', 'dist');

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
    await indexSongFromContent(req.params.fileId, req.body);
    res.json({ ok: true, file: metadata });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to save song' });
  }
});

app.get('/api/tags', (req, res) => {
  try {
    res.json({ tags: songIndex.listTags() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list tags' });
  }
});

app.get('/api/index/status', (req, res) => {
  try {
    res.json(songIndex.getIndexStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to read index status' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const rootFolderId = getRootFolderId();
    const scope = req.query.scope === 'folder' ? 'folder' : 'all';
    const folderId = req.query.folderId === 'root' ? rootFolderId : (req.query.folderId || '');
    let folderIdPath = '';

    if (scope === 'folder' && folderId && rootFolderId) {
      const context = await buildFolderContext(folderId, rootFolderId);
      folderIdPath = context.folderIdPath;
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const results = songIndex.searchSongs({
      q: req.query.q || '',
      tag: req.query.tag || '',
      key: req.query.key || '',
      artist: req.query.artist || '',
      folderIdPath,
      scope,
      limit,
      offset,
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Search failed' });
  }
});

app.post('/api/index/rebuild', requireUser, async (req, res) => {
  try {
    const canEdit = await userCanEditFolder(req.user.email);
    if (!canEdit) {
      res.status(403).json({ error: 'You need Editor access on the song library folder' });
      return;
    }

    if (songIndex.getIndexStatus().syncInProgress) {
      res.status(409).json({ error: 'Index sync is already in progress' });
      return;
    }

    await rebuildIndexAsync();
    res.json(songIndex.getIndexStatus());
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to rebuild index' });
  }
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // eslint-disable-next-line no-console
  console.warn('dist/ not found — run yarn build for the web UI');
}

app.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`ChordFiddle listening on http://0.0.0.0:${port}`);
  startBackgroundSync();
});
