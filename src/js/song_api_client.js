import { getAccessToken } from './google_auth';

const API_BASE = '/api';

async function apiFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const fetchHeaders = { ...headers };
  const token = getAccessToken();

  if (token) {
    fetchHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: fetchHeaders,
    body,
  });

  if (!response.ok) {
    let details = null;
    try {
      details = await response.json();
    } catch {
      details = null;
    }
    const error = new Error(details?.error || `API error (${response.status})`);
    error.status = response.status;
    error.details = details;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

export async function checkApiHealth() {
  return apiFetch('/health');
}

export async function listAllFolderContents(folderId) {
  return apiFetch(`/folders/${folderId}/contents`);
}

export async function loadSong(fileId) {
  return apiFetch(`/songs/${fileId}`);
}

export async function fetchMe() {
  return apiFetch('/me');
}

export async function saveSong(fileId, content) {
  return apiFetch(`/songs/${fileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
}

export async function renameSong(fileId, name) {
  return apiFetch(`/songs/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteSong(fileId) {
  return apiFetch(`/songs/${fileId}`, { method: 'DELETE' });
}

export async function createSong({ content, name, folderId }) {
  return apiFetch('/songs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, name, folderId }),
  });
}

export async function importFromUrl(url) {
  return apiFetch('/import/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export async function fetchTags() {
  return apiFetch('/tags');
}

export async function searchSongs({
  q = '',
  tag = '',
  key = '',
  artist = '',
  folderId = 'root',
  scope = 'all',
  limit = 50,
  offset = 0,
} = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (tag) params.set('tag', tag);
  if (key) params.set('key', key);
  if (artist) params.set('artist', artist);
  if (folderId) params.set('folderId', folderId);
  if (scope) params.set('scope', scope);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return apiFetch(`/search?${params.toString()}`);
}

export async function getIndexStatus() {
  return apiFetch('/index/status');
}

export async function rebuildIndex() {
  return apiFetch('/index/rebuild', { method: 'POST' });
}
