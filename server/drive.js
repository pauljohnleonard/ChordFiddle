const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const TEXT_PLAIN_MIME = 'text/plain';

const EDIT_ROLES = new Set(['owner', 'organizer', 'fileOrganizer', 'writer']);

let driveClient = null;

function getAuth() {
  const authOptions = {
    scopes: ['https://www.googleapis.com/auth/drive'],
  };

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    authOptions.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else {
    authOptions.keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
      || path.join(__dirname, '..', 'service-account.json');
  }

  return new google.auth.GoogleAuth(authOptions);
}

function getDrive() {
  if (!driveClient) {
    driveClient = google.drive({ version: 'v3', auth: getAuth() });
  }
  return driveClient;
}

function getDriveForAccessToken(accessToken) {
  const client = new OAuth2Client();
  client.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth: client });
}

function getRootFolderId() {
  if (process.env.DRIVE_FOLDER_ID) {
    return process.env.DRIVE_FOLDER_ID;
  }

  try {
    const config = require('../song-browser-config.json');
    return config.googleDrive.folderId || '';
  } catch {
    return '';
  }
}

function getAllowedExtensions() {
  try {
    const config = require('../song-browser-config.json');
    return config.googleDrive.allowedExtensions;
  } catch {
    return ['.cho', '.chopro', '.pro', '.crd', '.chordpro', '.txt', '.md'];
  }
}

function hasAllowedExtension(name, allowedExtensions) {
  const lower = name.toLowerCase();
  return allowedExtensions.some((ext) => lower.endsWith(ext));
}

function isSongFile(file, allowedExtensions) {
  if (file.mimeType === GOOGLE_DOC_MIME) {
    return true;
  }

  if (file.mimeType === SHORTCUT_MIME) {
    return hasAllowedExtension(file.name, allowedExtensions)
      || file.shortcutDetails?.targetMimeType === GOOGLE_DOC_MIME;
  }

  if (hasAllowedExtension(file.name, allowedExtensions)) {
    return true;
  }

  if (file.mimeType === TEXT_PLAIN_MIME) {
    return true;
  }

  return false;
}

function resolveFile(file) {
  if (file.mimeType === SHORTCUT_MIME && file.shortcutDetails?.targetId) {
    return {
      id: file.shortcutDetails.targetId,
      mimeType: file.shortcutDetails.targetMimeType,
      name: file.name,
    };
  }

  return file;
}

async function listFolderPage(folderId, { pageToken, allowedExtensions }) {
  const drive = getDrive();
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,parents,shortcutDetails)',
    orderBy: 'folder,name',
    pageSize: 100,
    pageToken,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const folders = [];
  const files = [];
  const skipped = [];

  (data.files || []).forEach((file) => {
    if (file.mimeType === FOLDER_MIME) {
      folders.push(file);
    } else if (isSongFile(file, allowedExtensions)) {
      files.push(file);
    } else {
      skipped.push(file);
    }
  });

  return {
    folders,
    files,
    skipped,
    nextPageToken: data.nextPageToken || null,
  };
}

async function listAllFolderContents(folderId) {
  const allowedExtensions = getAllowedExtensions();
  let pageToken;
  const folders = [];
  const files = [];
  const skipped = [];

  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await listFolderPage(folderId, { pageToken, allowedExtensions });
    folders.push(...page.folders);
    files.push(...page.files);
    skipped.push(...page.skipped);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return { folders, files, skipped };
}

async function getRawFileRecord(fileId) {
  const drive = getDrive();
  const { data } = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,modifiedTime,shortcutDetails,parents',
    supportsAllDrives: true,
  });
  return data;
}

async function getFileMetadata(fileId) {
  return resolveFile(await getRawFileRecord(fileId));
}

async function getStartChangesToken() {
  const drive = getDrive();
  const { data } = await drive.changes.getStartPageToken({
    supportsAllDrives: true,
  });
  return data.startPageToken;
}

async function listChanges(pageToken) {
  const drive = getDrive();
  const changes = [];
  let token = pageToken;
  let newStartPageToken = null;

  do {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await drive.changes.list({
      pageToken: token,
      spaces: 'drive',
      fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,parents,trashed,shortcutDetails))',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    changes.push(...(data.changes || []));
    if (data.newStartPageToken) {
      newStartPageToken = data.newStartPageToken;
      break;
    }
    token = data.nextPageToken;
  } while (token);

  return { changes, newStartPageToken };
}

async function buildFolderContext(folderId, rootFolderId) {
  if (!folderId) {
    return { folderPath: '', folderIdPath: rootFolderId };
  }

  const names = [];
  const ids = [];
  let currentId = folderId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    if (currentId === rootFolderId) {
      ids.unshift(currentId);
      break;
    }

    const drive = getDrive();
    // eslint-disable-next-line no-await-in-loop
    const { data } = await drive.files.get({
      fileId: currentId,
      fields: 'id,name,parents',
      supportsAllDrives: true,
    });

    names.unshift(data.name);
    ids.unshift(data.id);

    const parents = data.parents || [];
    if (parents.length === 0) {
      break;
    }

    [currentId] = parents;
  }

  if (!ids.includes(rootFolderId)) {
    return { folderPath: names.join(' / '), folderIdPath: ids.join('/') };
  }

  const rootIndex = ids.indexOf(rootFolderId);
  return {
    folderPath: names.slice(rootIndex + 1).join(' / '),
    folderIdPath: ids.slice(rootIndex).join('/'),
  };
}

async function isFileUnderRoot(fileId, rootFolderId) {
  if (fileId === rootFolderId) {
    return true;
  }

  const drive = getDrive();
  let currentId = fileId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    if (currentId === rootFolderId) {
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    const { data } = await drive.files.get({
      fileId: currentId,
      fields: 'parents',
      supportsAllDrives: true,
    });

    const parents = data.parents || [];
    if (parents.length === 0) {
      return false;
    }

    [currentId] = parents;
  }

  return false;
}

async function downloadSongContent(file) {
  const resolved = resolveFile(file);
  const drive = getDrive();

  if (resolved.mimeType === GOOGLE_DOC_MIME) {
    const { data } = await drive.files.export({
      fileId: resolved.id,
      mimeType: TEXT_PLAIN_MIME,
    }, { responseType: 'text' });
    return data;
  }

  const { data } = await drive.files.get({
    fileId: resolved.id,
    alt: 'media',
    supportsAllDrives: true,
  }, { responseType: 'text' });
  return data;
}

async function uploadSongContent(file, content) {
  const resolved = resolveFile(file);

  if (resolved.mimeType === GOOGLE_DOC_MIME) {
    const error = new Error('Saving Google Docs is not supported. Use .pro files.');
    error.status = 400;
    throw error;
  }

  const drive = getDrive();
  await drive.files.update({
    fileId: resolved.id,
    media: {
      mimeType: 'application/octet-stream',
      body: content,
    },
    supportsAllDrives: true,
  });
}

function normalizeRenameName(currentName, requestedName, allowedExtensions) {
  const trimmed = requestedName.trim();
  if (!trimmed) {
    const error = new Error('Name is required');
    error.status = 400;
    throw error;
  }

  if (hasAllowedExtension(trimmed, allowedExtensions)) {
    return trimmed;
  }

  const lower = currentName.toLowerCase();
  const ext = allowedExtensions.find((candidate) => lower.endsWith(candidate));
  return ext ? `${trimmed}${ext}` : trimmed;
}

async function renameSongFile(fileId, newName, { accessToken } = {}) {
  const raw = await getRawFileRecord(fileId);
  const allowedExtensions = getAllowedExtensions();
  const name = normalizeRenameName(raw.name, newName, allowedExtensions);
  const drive = accessToken ? getDriveForAccessToken(accessToken) : getDrive();
  const { data } = await drive.files.update({
    fileId: raw.id,
    requestBody: { name },
    fields: 'id,name,mimeType,modifiedTime,parents,shortcutDetails',
    supportsAllDrives: true,
  });

  return data;
}

async function trashSongFile(fileId, { accessToken } = {}) {
  const raw = await getRawFileRecord(fileId);
  const drive = accessToken ? getDriveForAccessToken(accessToken) : getDrive();
  await drive.files.update({
    fileId: raw.id,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
}

async function createSongFile({
  name, content, parentFolderId = getRootFolderId(), accessToken,
}) {
  if (!parentFolderId) {
    const error = new Error('DRIVE_FOLDER_ID is not configured on the server');
    error.status = 500;
    throw error;
  }

  if (!accessToken) {
    const error = new Error('Sign in with Google to create new songs');
    error.status = 401;
    throw error;
  }

  // New files must be created as the signed-in user — service accounts have no Drive quota.
  const drive = getDriveForAccessToken(accessToken);
  const { data } = await drive.files.create({
    requestBody: {
      name,
      parents: [parentFolderId],
      mimeType: TEXT_PLAIN_MIME,
    },
    media: {
      mimeType: TEXT_PLAIN_MIME,
      body: content,
    },
    fields: 'id,name,mimeType,modifiedTime,parents',
    supportsAllDrives: true,
  });

  return resolveFile(data);
}

async function userCanEditFolder(email, folderId = getRootFolderId()) {
  const drive = getDrive();
  const normalizedEmail = email.toLowerCase();

  const { data: fileData } = await drive.files.get({
    fileId: folderId,
    fields: 'owners(emailAddress)',
    supportsAllDrives: true,
  });

  if ((fileData.owners || []).some((owner) => owner.emailAddress?.toLowerCase() === normalizedEmail)) {
    return true;
  }

  const { data: permData } = await drive.permissions.list({
    fileId: folderId,
    fields: 'permissions(emailAddress,role,type)',
    supportsAllDrives: true,
  });

  return (permData.permissions || []).some((permission) => (
    permission.emailAddress?.toLowerCase() === normalizedEmail
    && EDIT_ROLES.has(permission.role)
  ));
}

module.exports = {
  getRootFolderId,
  getAllowedExtensions,
  isSongFile,
  resolveFile,
  getRawFileRecord,
  listAllFolderContents,
  getFileMetadata,
  downloadSongContent,
  uploadSongContent,
  renameSongFile,
  trashSongFile,
  createSongFile,
  userCanEditFolder,
  getStartChangesToken,
  listChanges,
  isFileUnderRoot,
  buildFolderContext,
};
