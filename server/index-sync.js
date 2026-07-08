const {
  getRootFolderId,
  listAllFolderContents,
  getFileMetadata,
  downloadSongContent,
  getStartChangesToken,
  listChanges,
  isFileUnderRoot,
  buildFolderContext,
  isSongFile,
  getAllowedExtensions,
  resolveFile,
} = require('./drive');
const { parseChordProMetadata } = require('./chordpro-metadata');
const songIndex = require('./song-index');

let syncPromise = null;

const INDEX_BATCH_SIZE = 5;

async function mapInBatches(items, batchSize, fn) {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(fn));
  }
}

function buildFolderIdPath(ancestorIds) {
  return ancestorIds.join('/');
}

async function indexSongRecord(file, {
  parentFolderId,
  folderPath,
  folderIdPath,
  content = null,
}) {
  const resolved = resolveFile(file);

  try {
    let parsed = content != null ? parseChordProMetadata(content) : null;

    if (!parsed) {
      const downloaded = await downloadSongContent(file);
      parsed = parseChordProMetadata(downloaded);
    }

    songIndex.upsertSong({
      fileId: resolved.id,
      name: file.name,
      parentFolderId,
      folderPath,
      folderIdPath,
      modifiedTime: file.modifiedTime || null,
      title: parsed.title,
      subtitle: parsed.subtitle,
      artist: parsed.artist,
      key: parsed.key,
      capo: parsed.capo,
      tempo: parsed.tempo,
      tags: parsed.tags,
      parseError: parsed.parseError,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to index ${file.name}:`, error.message);
    songIndex.upsertSong({
      fileId: resolved.id,
      name: file.name,
      parentFolderId,
      folderPath,
      folderIdPath,
      modifiedTime: file.modifiedTime || null,
      title: null,
      subtitle: null,
      artist: null,
      key: null,
      capo: null,
      tempo: null,
      tags: [],
      parseError: error.message,
    });
  }
}

async function crawlFolder(folderId, {
  pathSegments = [],
  ancestorIds = [],
} = {}) {
  const folderPath = pathSegments.join(' / ');
  songIndex.setSyncCurrentPath(folderPath || 'Library root');
  const folderIdPath = buildFolderIdPath(ancestorIds);
  const { folders, files } = await listAllFolderContents(folderId);

  await mapInBatches(files, INDEX_BATCH_SIZE, (file) => indexSongRecord(file, {
    parentFolderId: folderId,
    folderPath,
    folderIdPath,
  }));

  await folders.reduce(async (previous, folder) => {
    await previous;
    await crawlFolder(folder.id, {
      pathSegments: [...pathSegments, folder.name],
      ancestorIds: [...ancestorIds, folder.id],
    });
  }, Promise.resolve());
}

async function rebuildIndex() {
  const rootFolderId = getRootFolderId();
  if (!rootFolderId) {
    throw new Error('DRIVE_FOLDER_ID is not configured on the server');
  }

  songIndex.clearIndex();
  await crawlFolder(rootFolderId, {
    pathSegments: [],
    ancestorIds: [rootFolderId],
  });

  const changesToken = await getStartChangesToken();
  songIndex.setMeta('changes_page_token', changesToken);
  songIndex.setMeta('last_sync_at', new Date().toISOString());
}

async function indexSongFromContent(fileId, content) {
  const file = await getFileMetadata(fileId);
  const existing = songIndex.getSongByFileId(fileId);
  const parents = file.parents || [];
  const parentFolderId = parents[0] || existing?.parentFolderId || null;
  const parsed = parseChordProMetadata(content);

  songIndex.upsertSong({
    fileId,
    name: file.name,
    parentFolderId,
    folderPath: existing?.folderPath || '',
    folderIdPath: existing?.folderIdPath || '',
    modifiedTime: file.modifiedTime || new Date().toISOString(),
    title: parsed.title,
    subtitle: parsed.subtitle,
    artist: parsed.artist,
    key: parsed.key,
    capo: parsed.capo,
    tempo: parsed.tempo,
    tags: parsed.tags,
    parseError: parsed.parseError,
  });
}

async function applyDriveChange(change, rootFolderId) {
  if (change.removed) {
    songIndex.removeSong(change.fileId);
    return;
  }

  const file = change.file;
  if (!file || file.trashed) {
    songIndex.removeSong(change.fileId);
    return;
  }

  const allowedExtensions = getAllowedExtensions();
  if (!isSongFile(file, allowedExtensions)) {
    return;
  }

  const underRoot = await isFileUnderRoot(file.id, rootFolderId);
  if (!underRoot) {
    songIndex.removeSong(file.id);
    return;
  }

  const parentFolderId = (file.parents || [])[0] || null;
  const existing = songIndex.getSongByFileId(file.id);

  let folderPath = existing?.folderPath || '';
  let folderIdPath = existing?.folderIdPath || '';

  if (!folderIdPath && parentFolderId) {
    const context = await buildFolderContext(parentFolderId, rootFolderId);
    folderPath = context.folderPath;
    folderIdPath = context.folderIdPath;
  }

  await indexSongRecord(file, {
    parentFolderId,
    folderPath,
    folderIdPath,
  });
}

async function syncChanges() {
  const rootFolderId = getRootFolderId();
  if (!rootFolderId) {
    return;
  }

  songIndex.setSyncPhase('changes');
  songIndex.setSyncCurrentPath('Checking Drive changes');

  let pageToken = songIndex.getMeta('changes_page_token');
  if (!pageToken) {
    pageToken = await getStartChangesToken();
    songIndex.setMeta('changes_page_token', pageToken);
    return;
  }

  const { changes, newStartPageToken } = await listChanges(pageToken);

  await changes.reduce(async (previous, change) => {
    await previous;
    await applyDriveChange(change, rootFolderId);
  }, Promise.resolve());

  if (newStartPageToken) {
    songIndex.setMeta('changes_page_token', newStartPageToken);
  }

  songIndex.setMeta('last_sync_at', new Date().toISOString());
}

async function runSync(task, phase) {
  if (syncPromise) {
    return syncPromise;
  }

  songIndex.setSyncInProgress(true);
  songIndex.setSyncPhase(phase);
  syncPromise = task()
    .catch((error) => {
      songIndex.setLastSyncError(error.message);
      // eslint-disable-next-line no-console
      console.error('Song index sync failed:', error.message);
      throw error;
    })
    .finally(() => {
      songIndex.setSyncInProgress(false);
      songIndex.clearSyncProgress();
      syncPromise = null;
    });

  return syncPromise;
}

function indexNeedsRebuild() {
  return songIndex.getSongCount() === 0 || !songIndex.getMeta('last_sync_at');
}

function startBackgroundSync() {
  if (!getRootFolderId()) {
    return;
  }

  const needsRebuild = indexNeedsRebuild();
  const task = needsRebuild ? rebuildIndex : syncChanges;
  const phase = needsRebuild ? 'rebuild' : 'changes';

  runSync(task, phase).catch(() => {});

  const intervalMs = Number(process.env.INDEX_SYNC_INTERVAL_MS) || 15 * 60 * 1000;
  setInterval(() => {
    if (!songIndex.getIndexStatus().syncInProgress) {
      runSync(syncChanges, 'changes').catch(() => {});
    }
  }, intervalMs);
}

function rebuildIndexAsync() {
  return runSync(rebuildIndex, 'rebuild');
}

module.exports = {
  rebuildIndex,
  rebuildIndexAsync,
  indexSongFromContent,
  syncChanges,
  startBackgroundSync,
  indexNeedsRebuild,
};
