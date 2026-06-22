const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const TOKEN_STORAGE_KEY = 'songBrowserGoogleAuth';
const SCOPES = [
  'openid',
  'email',
  'profile',
];

let accessToken = null;
let tokenClient = null;
let currentUser = null;
let pendingTokenRequest = null;
const listeners = new Set();

function getClientId() {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || '';
}

function notifyListeners() {
  listeners.forEach((listener) => listener({
    isSignedIn: isSignedIn(),
    user: currentUser,
  }));
}

function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistSession(token, expiresIn) {
  const expiresAt = Date.now() + (expiresIn || 3600) * 1000;
  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt }));
}

function clearStoredSession() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

function isStoredSessionValid(stored) {
  return stored?.token && stored.expiresAt > Date.now() + 60_000;
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

async function fetchUserInfo() {
  if (!accessToken) {
    currentUser = null;
    return null;
  }

  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    currentUser = null;
    return null;
  }

  currentUser = await response.json();
  return currentUser;
}

async function setSessionFromResponse(response) {
  accessToken = response.access_token;
  persistSession(response.access_token, response.expires_in);
  await fetchUserInfo();
}

function initTokenClient() {
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: getClientId(),
    scope: SCOPES.join(' '),
    callback: async (response) => {
      if (response.error) {
        if (pendingTokenRequest) {
          pendingTokenRequest.reject(new Error(response.error));
          pendingTokenRequest = null;
        }
        return;
      }

      await setSessionFromResponse(response);

      if (pendingTokenRequest) {
        pendingTokenRequest.resolve();
        pendingTokenRequest = null;
      }

      notifyListeners();
    },
  });
}

function requestAccessToken({ prompt = '' } = {}) {
  if (!tokenClient) {
    return Promise.reject(new Error('Google sign-in is not configured.'));
  }

  return new Promise((resolve, reject) => {
    pendingTokenRequest = { resolve, reject };
    tokenClient.requestAccessToken({ prompt });
  });
}

async function restoreSession() {
  const stored = readStoredSession();

  if (!isStoredSessionValid(stored)) {
    return;
  }

  accessToken = stored.token;
  const user = await fetchUserInfo();
  if (user) {
    notifyListeners();
    return;
  }

  clearStoredSession();
  accessToken = null;
  currentUser = null;
}

export function isOAuthConfigured() {
  return getClientId().length > 0;
}

export function isSignedIn() {
  return accessToken !== null;
}

export function getAccessToken() {
  return accessToken;
}

export function onAuthChange(listener) {
  listeners.add(listener);
  listener({ isSignedIn: isSignedIn(), user: currentUser });
  return () => listeners.delete(listener);
}

let initPromise = null;

export async function initGoogleAuth() {
  if (!isOAuthConfigured()) {
    return;
  }

  if (!initPromise) {
    initPromise = (async () => {
      await loadGoogleIdentityServices();
      initTokenClient();
      await restoreSession();
    })();
  }

  return initPromise;
}

export function signIn() {
  return requestAccessToken({ prompt: 'select_account' });
}

export function signOut() {
  const token = accessToken;
  accessToken = null;
  currentUser = null;
  clearStoredSession();
  notifyListeners();

  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
}
