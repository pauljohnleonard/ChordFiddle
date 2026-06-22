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
