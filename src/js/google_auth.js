const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SCOPES = [
  'openid',
  'email',
  'profile',
];

let accessToken = null;
let tokenClient = null;
let currentUser = null;
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

function initTokenClient() {
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: getClientId(),
    scope: SCOPES.join(' '),
    callback: async (response) => {
      if (response.error) {
        console.error(response.error);
        return;
      }

      accessToken = response.access_token;
      await fetchUserInfo();
      notifyListeners();
    },
  });
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

export async function initGoogleAuth() {
  if (!isOAuthConfigured()) {
    return;
  }

  await loadGoogleIdentityServices();
  initTokenClient();
}

export function signIn() {
  if (!tokenClient) {
    throw new Error('Google sign-in is not configured. Add GOOGLE_OAUTH_CLIENT_ID to .env.');
  }

  tokenClient.requestAccessToken({ prompt: '' });
}

export function signOut() {
  if (!accessToken) {
    return;
  }

  window.google.accounts.oauth2.revoke(accessToken, () => {
    accessToken = null;
    currentUser = null;
    notifyListeners();
  });
}
