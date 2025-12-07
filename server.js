/**
 * server.js
 *  - GitHub OAuth (web redirect) entry: /login -> GitHub -> /callback (redirects to callback.html)
 *  - Server-side exchange endpoint: POST /exchange (used by public/callback.html)
 *  - Optional server-side callback renderer: GET /callback-server (exchanges code and returns HTML)
 *  - Device flow: POST /device/start and POST /device/poll
 *
 * Notes:
 *  - Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in environment (Render / .env)
 *  - REDIRECT_URI should match the OAuth app callback (default below)
 *  - Do NOT commit secrets to repo for production
 */
const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'Ov23li8NuJaGgSulRZ51';
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '41d0344ebc20a9480dada875d4329073db564053';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://auth-onequantum-developers.onrender.com/callback';
const PORT = process.env.PORT || 3000;

if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
  console.warn('Warning: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not found in env. Falling back to provided defaults. For production, set env variables and do not commit secrets.');
}

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// In-memory state store for demo (not for production)
const stateStore = new Map();

// Helper: create authorize URL for web OAuth
function buildAuthorizeUrl(state, scope = 'read:user user:email') {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope,
    state
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

// Start standard web OAuth flow
app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, Date.now());
  const authorizeUrl = buildAuthorizeUrl(state);
  res.redirect(authorizeUrl);
});

// Primary callback endpoint used in OAuth app: preserve query and redirect to static callback page
// This ensures GitHub's redirect will land on /callback and the browser will be forwarded to /callback.html
app.get('/callback', (req, res) => {
  // preserve original query string (code, state)
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  return res.redirect('/callback.html' + qs);
});

// Optional: direct server-side exchange and render result (useful for testing or if you prefer server render).
// You can configure your OAuth app to use /callback-server as the callback if you want server-side rendering.
app.get('/callback-server', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing code');
  if (!state || !stateStore.has(state)) {
    console.warn('State missing or unknown (callback-server):', state);
    // For demo we continue, but for security you should reject this request.
  } else {
    stateStore.delete(state);
  }

  try {
    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI
      }).toString(),
      { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const tokenData = tokenResp.data;
    if (tokenData.error) {
      return res.status(400).json(tokenData);
    }
    const accessToken = tokenData.access_token;

    const userResp = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${accessToken}`, Accept: 'application/json', 'User-Agent': '1Quantum-Auth-Demo' }
    });
    const user = userResp.data;

    return res.send(`
      <!doctype html>
      <html>
      <head><meta charset="utf-8"><title>Callback - Server</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body{font-family:system-ui,Arial;padding:24px;background:#f4f6fb}
          .card{background:#fff;padding:18px;border-radius:8px;max-width:720px;margin:18px auto;box-shadow:0 6px 18px rgba(10,20,40,0.06)}
          pre{background:#0b1a2b;color:#e6f0ff;padding:8px;border-radius:6px;overflow:auto}
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Logged in as ${user.login}</h1>
          <img src="${user.avatar_url}" width="80" style="border-radius:8px"/>
          <pre>${JSON.stringify(user, null, 2)}</pre>
          <p>Access token (truncated): ${accessToken ? accessToken.slice(0, 12) + '...' : 'none'}</p>
          <p><a href="/">Back</a></p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('callback-server error', err.response ? err.response.data : err.message);
    return res.status(500).send('Authentication failed');
  }
});

// Client-side exchange endpoint: public/callback.html will POST code+state here.
// Server performs token exchange using the client secret (kept on server) and returns JSON (token + user).
app.post('/exchange', async (req, res) => {
  const { code, state } = req.body;
  if (!code) return res.status(400).json({ error: 'missing_code' });

  if (!state || !stateStore.has(state)) {
    console.warn('State missing or unknown (exchange):', state);
    // For demo allow it; in production you should reject the request or verify session state.
  } else {
    stateStore.delete(state);
  }

  try {
    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI
      }).toString(),
      { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const tokenData = tokenResp.data;
    if (tokenData.error) {
      return res.status(400).json({ error: tokenData.error, details: tokenData });
    }

    const accessToken = tokenData.access_token;
    const userResp = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${accessToken}`, Accept: 'application/json', 'User-Agent': '1Quantum-Auth-Demo' }
    });

    return res.json({ success: true, tokenData, user: userResp.data });
  } catch (err) {
    console.error('Exchange error', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'exchange_failed' });
  }
});

// Device Flow: start - requests device/user codes from GitHub
app.post('/device/start', async (req, res) => {
  const scope = req.body.scope || 'read:user user:email';
  try {
    const resp = await axios.post(
      'https://github.com/login/device/code',
      new URLSearchParams({ client_id: CLIENT_ID, scope }).toString(),
      { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    // Response: device_code, user_code, verification_uri, expires_in, interval
    res.json(resp.data);
  } catch (err) {
    console.error('Device/start error', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'device_start_failed' });
  }
});

// Device Flow: poll - exchange device_code for access_token (called repeatedly by client)
app.post('/device/poll', async (req, res) => {
  const { device_code } = req.body;
  if (!device_code) return res.status(400).json({ error: 'device_code_required' });

  try {
    const resp = await axios.post(
      'https://github.com/login/oauth/access_token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }).toString(),
      { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const data = resp.data;
    // If access_token present, fetch user and return success
    if (data.access_token) {
      const userResp = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `token ${data.access_token}`, Accept: 'application/json', 'User-Agent': '1Quantum-Auth-Demo' }
      });
      return res.json({ success: true, tokenData: data, user: userResp.data });
    }
    // Otherwise forward transient errors like authorization_pending, slow_down, expired_token, etc.
    return res.json({ success: false, data });
  } catch (err) {
    console.error('Device/poll error', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'device_poll_failed' });
  }
});

// Root health-check
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Auth server listening on port ${PORT}`);
  console.log(`Web login: http://localhost:${PORT}/login`);
  console.log(`Configured REDIRECT_URI: ${REDIRECT_URI}`);
});