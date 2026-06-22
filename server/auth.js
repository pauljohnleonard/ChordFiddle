const { OAuth2Client } = require('google-auth-library');

function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID is not configured');
  }
  return new OAuth2Client(clientId);
}

async function verifyAccessToken(accessToken) {
  const client = getOAuthClient();
  const ticket = await client.getTokenInfo(accessToken);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  if (ticket.aud !== clientId && ticket.azp !== clientId) {
    const error = new Error('Token was not issued for this application');
    error.status = 401;
    throw error;
  }

  if (!ticket.email) {
    const error = new Error('Token does not include an email address');
    error.status = 401;
    throw error;
  }

  return {
    email: ticket.email,
    emailVerified: ticket.email_verified === true || ticket.email_verified === 'true',
  };
}

async function requireUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sign in with Google to continue' });
    return;
  }

  try {
    const accessToken = authHeader.slice(7);
    req.user = await verifyAccessToken(accessToken);
    next();
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message || 'Invalid sign-in token' });
  }
}

module.exports = {
  verifyAccessToken,
  requireUser,
};
