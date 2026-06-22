const { google } = require('googleapis');
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
    fields: 'nextPageToken,files(id,name,mimeType,shortcutDetails)',
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

async function getFileMetadata(fileId) {
  const drive = getDrive();
  const { data } = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,shortcutDetails,parents',
    supportsAllDrives: true,
  });
  return resolveFile(data);
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
  listAllFolderContents,
  getFileMetadata,
  downloadSongContent,
  uploadSongContent,
  userCanEditFolder,
};
