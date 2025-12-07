const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'Ov23li8NuJaGgSulRZ51';
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '41d0344ebc20a9480dada875d4329073db564053';
// DEFAULT REDIRECT_URI changed to the deployed domain you reported
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://auth-1quantum-developers.onrender.com/callback';
const PORT = process.env.PORT || 3000;

console.log('Starting auth server with REDIRECT_URI:', REDIRECT_URI);

if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
  console.warn('Warning: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set in env. Using defaults (not secure).');
}

// Serve static files
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Simple in-memory state store for demo (not production-safe)
const stateStore = new Map();

function buildAuthorizeUrl(state, scope = 'read:user user:email') {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope,
    state
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, Date.now());
  res.redirect(buildAuthorizeUrl(state));
});

// Keep GitHub callback URL working: redirect to static callback page and preserve ?code&state
app.get('/callback', (req, res) => {
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  return res.redirect('/callback.html' + qs);
});

// Optional: server-side exchange and render (callback-server)
app.get('/callback-server', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing code');
  if (!state || !stateStore.has(state)) {
    console.warn('State missing or unknown (callback-server):', state);
  } else {
    stateStore.delete(state);
  }

  try {
    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, redirect_uri: REDIRECT_URI }).toString(),
      { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const tokenData = tokenResp.data;
    if (tokenData.error) return res.status(400).json(tokenData);
    const accessToken = tokenData.access_token;
    const userResp = await axios.get('https://api.github.com/user', { headers: { Authorization: `token ${accessToken}`, Accept: 'application/json', 'User-Agent': '1Quantum-Auth-Demo' }});
    const user = userResp.data;
    return res.send(`<h1>Logged in as ${user.login}</h1><img src="${user.avatar_url}" width="80"/><pre>${JSON.stringify(user,null,2)}</pre><p><a href="/">Back</a></p>`);
  } catch (err) {
    console.error('callback-server error', err.response ? err.response.data : err.message);
    return res.status(500).send('Authentication failed');
  }
});

// Client-side exchange endpoint used by public/callback.html
app.post('/exchange', async (req, res) => {
  const { code, state } = req.body;
  if (!code) return res.status(400).json({ error: 'missing_code' });

  if (!state || !stateStore.has(state)) {
    console.warn('State missing or unknown (exchange):', state);
  } else {
    stateStore.delete(state);
  }

  try {
    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, redirect_uri: REDIRECT_URI }).toString(),
      { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const tokenData = tokenResp.data;
    if (tokenData.error) return res.status(400).json({ error: tokenData.error, details: tokenData });

    const accessToken = tokenData.access_token;
    const userResp = await axios.get('https://api.github.com/user', { headers: { Authorization: `token ${accessToken}`, Accept: 'application/json', 'User-Agent': '1Quantum-Auth-Demo' }});
    return res.json({ success: true, tokenData, user: userResp.data });
  } catch (err) {
    console.error('Exchange error', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'exchange_failed' });
  }
});

// Device flow endpoints
app.post('/device/start', async (req, res) => {
  const scope = req.body.scope || 'read:user user:email';
  try {
    const resp = await axios.post('https://github.com/login/device/code', new URLSearchParams({ client_id: CLIENT_ID, scope }).toString(), { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }});
    return res.json(resp.data);
  } catch (err) {
    console.error('Device/start error', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'device_start_failed' });
  }
});

app.post('/device/poll', async (req, res) => {
  const { device_code } = req.body;
  if (!device_code) return res.status(400).json({ error: 'device_code_required' });
  try {
    const resp = await axios.post('https://github.com/login/oauth/access_token', new URLSearchParams({ client_id: CLIENT_ID, device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString(), { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }});
    const data = resp.data;
    if (data.access_token) {
      const userResp = await axios.get('https://api.github.com/user', { headers: { Authorization: `token ${data.access_token}`, Accept: 'application/json', 'User-Agent': '1Quantum-Auth-Demo' }});
      return res.json({ success: true, tokenData: data, user: userResp.data });
    }
    return res.json({ success: false, data });
  } catch (err) {
    console.error('Device/poll error', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'device_poll_failed' });
  }
});

// Root
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Set up rate limiter for fallback static file route
const fallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
});

// Fallback: prevent client-side route 404s. Do not override API routes above.
app.get('*', fallbackLimiter, (req, res) => {
  // If it's a known API path, return 404 so client sees an error.
  const apiPrefixes = ['/exchange', '/device', '/login', '/callback-server', '/health'];
  if (apiPrefixes.some(p => req.path.startsWith(p))) return res.status(404).send('Not found');
  return res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Auth server listening on port ${PORT}`);
  console.log(`Configured REDIRECT_URI: ${REDIRECT_URI}`);
});
