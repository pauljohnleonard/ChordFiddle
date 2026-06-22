const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'song-index.sqlite');

let db = null;

function getDb() {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      file_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_folder_id TEXT,
      folder_path TEXT NOT NULL DEFAULT '',
      folder_id_path TEXT NOT NULL DEFAULT '',
      modified_time TEXT,
      title TEXT,
      artist TEXT,
      song_key TEXT,
      capo TEXT,
      tempo TEXT,
      parse_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS song_tags (
      file_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (file_id, tag),
      FOREIGN KEY (file_id) REFERENCES songs(file_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_song_tags_tag ON song_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_songs_folder_id_path ON songs(folder_id_path);
    CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
    CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);

    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getMeta(key) {
  const row = getDb().prepare('SELECT value FROM index_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  getDb().prepare(`
    INSERT INTO index_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function upsertSong(record) {
  const database = getDb();
  const now = new Date().toISOString();

  const upsert = database.prepare(`
    INSERT INTO songs (
      file_id, name, parent_folder_id, folder_path, folder_id_path, modified_time,
      title, artist, song_key, capo, tempo, parse_error, updated_at
    ) VALUES (
      @fileId, @name, @parentFolderId, @folderPath, @folderIdPath, @modifiedTime,
      @title, @artist, @songKey, @capo, @tempo, @parseError, @updatedAt
    )
    ON CONFLICT(file_id) DO UPDATE SET
      name = excluded.name,
      parent_folder_id = excluded.parent_folder_id,
      folder_path = excluded.folder_path,
      folder_id_path = excluded.folder_id_path,
      modified_time = excluded.modified_time,
      title = excluded.title,
      artist = excluded.artist,
      song_key = excluded.song_key,
      capo = excluded.capo,
      tempo = excluded.tempo,
      parse_error = excluded.parse_error,
      updated_at = excluded.updated_at
  `);

  const deleteTags = database.prepare('DELETE FROM song_tags WHERE file_id = ?');
  const insertTag = database.prepare('INSERT INTO song_tags (file_id, tag) VALUES (?, ?)');

  const transaction = database.transaction((song) => {
    upsert.run({
      fileId: song.fileId,
      name: song.name,
      parentFolderId: song.parentFolderId,
      folderPath: song.folderPath,
      folderIdPath: song.folderIdPath,
      modifiedTime: song.modifiedTime,
      title: song.title,
      artist: song.artist,
      songKey: song.key,
      capo: song.capo,
      tempo: song.tempo,
      parseError: song.parseError,
      updatedAt: now,
    });

    deleteTags.run(song.fileId);
    song.tags.forEach((tag) => {
      insertTag.run(song.fileId, tag);
    });
  });

  transaction(record);
}

function removeSong(fileId) {
  getDb().prepare('DELETE FROM songs WHERE file_id = ?').run(fileId);
}

function getSongByFileId(fileId) {
  const row = getDb().prepare(`
    SELECT
      file_id AS fileId,
      name,
      parent_folder_id AS parentFolderId,
      folder_path AS folderPath,
      folder_id_path AS folderIdPath,
      modified_time AS modifiedTime
    FROM songs
    WHERE file_id = ?
  `).get(fileId);

  if (!row) {
    return null;
  }

  const tags = getDb().prepare('SELECT tag FROM song_tags WHERE file_id = ? ORDER BY tag ASC')
    .all(fileId)
    .map((tagRow) => tagRow.tag);

  return { ...row, tags };
}

function clearIndex() {
  const database = getDb();
  database.exec('DELETE FROM song_tags; DELETE FROM songs;');
}

function getSongCount() {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM songs').get();
  return row.count;
}

function listTags() {
  return getDb().prepare(`
    SELECT tag, COUNT(*) AS count
    FROM song_tags
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `).all();
}

function searchSongs({
  q = '',
  tag = '',
  key = '',
  artist = '',
  folderIdPath = '',
  scope = 'all',
  limit = 50,
  offset = 0,
}) {
  const conditions = [];
  const params = {};

  const query = q.trim().toLowerCase();
  if (query) {
    conditions.push(`(
      LOWER(COALESCE(s.title, '')) LIKE @q OR
      LOWER(COALESCE(s.artist, '')) LIKE @q OR
      LOWER(s.name) LIKE @q OR
      LOWER(COALESCE(s.folder_path, '')) LIKE @q
    )`);
    params.q = `%${query}%`;
  }

  if (tag) {
    conditions.push('EXISTS (SELECT 1 FROM song_tags t WHERE t.file_id = s.file_id AND t.tag = @tag)');
    params.tag = tag.trim().toLowerCase();
  }

  if (key) {
    conditions.push('LOWER(COALESCE(s.song_key, \'\')) = @key');
    params.key = key.trim().toLowerCase();
  }

  if (artist) {
    conditions.push('LOWER(COALESCE(s.artist, \'\')) LIKE @artist');
    params.artist = `%${artist.trim().toLowerCase()}%`;
  }

  if (scope === 'folder' && folderIdPath) {
    conditions.push(`(
      s.folder_id_path = @folderIdPath OR
      s.folder_id_path LIKE @folderIdPathPrefix
    )`);
    params.folderIdPath = folderIdPath;
    params.folderIdPathPrefix = `${folderIdPath}/%`;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = getDb().prepare(`
    SELECT COUNT(*) AS count
    FROM songs s
    ${whereClause}
  `).get(params);

  const rows = getDb().prepare(`
    SELECT
      s.file_id AS fileId,
      s.name,
      s.parent_folder_id AS parentFolderId,
      s.folder_path AS folderPath,
      s.title,
      s.artist,
      s.song_key AS key,
      s.capo,
      s.tempo,
      s.parse_error AS parseError
    FROM songs s
    ${whereClause}
    ORDER BY COALESCE(s.title, s.name) COLLATE NOCASE ASC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  const tagsByFile = {};
  if (rows.length > 0) {
    const fileIds = rows.map((row) => row.fileId);
    const placeholders = fileIds.map((_, index) => `@id${index}`).join(', ');
    const tagParams = Object.fromEntries(fileIds.map((id, index) => [`id${index}`, id]));
    const tagRows = getDb().prepare(`
      SELECT file_id AS fileId, tag
      FROM song_tags
      WHERE file_id IN (${placeholders})
      ORDER BY tag ASC
    `).all(tagParams);

    tagRows.forEach((row) => {
      if (!tagsByFile[row.fileId]) {
        tagsByFile[row.fileId] = [];
      }
      tagsByFile[row.fileId].push(row.tag);
    });
  }

  return {
    total: countRow.count,
    limit,
    offset,
    songs: rows.map((row) => ({
      ...row,
      tags: tagsByFile[row.fileId] || [],
    })),
  };
}

function getIndexStatus() {
  return {
    songCount: getSongCount(),
    lastSyncAt: getMeta('last_sync_at'),
    syncInProgress: getMeta('sync_in_progress') === 'true',
    syncPhase: getMeta('sync_phase') || null,
    syncStartedAt: getMeta('sync_started_at') || null,
    syncCurrentPath: getMeta('sync_current_path') || null,
    lastSyncError: getMeta('last_sync_error') || null,
  };
}

function setSyncInProgress(inProgress) {
  setMeta('sync_in_progress', inProgress ? 'true' : 'false');
  if (inProgress) {
    setMeta('sync_started_at', new Date().toISOString());
    setMeta('last_sync_error', '');
  }
}

function setSyncPhase(phase) {
  setMeta('sync_phase', phase || '');
}

function setSyncCurrentPath(folderPath) {
  setMeta('sync_current_path', folderPath || '');
}

function setLastSyncError(message) {
  setMeta('last_sync_error', message || '');
}

function clearSyncProgress() {
  setMeta('sync_phase', '');
  setMeta('sync_current_path', '');
  setMeta('sync_started_at', '');
}

module.exports = {
  upsertSong,
  removeSong,
  getSongByFileId,
  clearIndex,
  getSongCount,
  listTags,
  searchSongs,
  getIndexStatus,
  getMeta,
  setMeta,
  setSyncInProgress,
  setSyncPhase,
  setSyncCurrentPath,
  setLastSyncError,
  clearSyncProgress,
};
