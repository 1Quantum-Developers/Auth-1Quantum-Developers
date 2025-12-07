const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
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

app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory state store for demo (not for production)
const stateStore = new Map();

// Start regular OAuth web flow
app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  // store state for later validation
  stateStore.set(state, Date.now());
  const scope = 'read:user user:email';
  const authorizeUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  res.redirect(authorizeUrl);
});

// OAuth callback
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('Missing code');
  }
  if (!state || !stateStore.has(state)) {
    console.warn('State missing or unknown:', state);
    // proceed but warn; in production reject
  } else {
    stateStore.delete(state);
  }

  try {
    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI
      },
      { headers: { Accept: 'application/json' } }
    );

    const tokenData = tokenResp.data;
    if (tokenData.error) {
      return res.status(400).json(tokenData);
    }
    const accessToken = tokenData.access_token;
    // Fetch user
    const userResp = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${accessToken}`, Accept: 'application/json', 'User-Agent': '1Quantum-Auth-Demo' }
    });
    // For demo we return a simple HTML page with user info
    const user = userResp.data;
    return res.send(`
      <h1>Logged in as ${user.login}</h1>
      <img src="${user.avatar_url}" width="80" />
      <pre>${JSON.stringify(user, null, 2)}</pre>
      <p>Access token (truncated): ${accessToken ? accessToken.slice(0, 12) + '...' : 'none'}</p>
      <p><a href="/">Back</a></p>
    `);
  } catch (err) {
    console.error('Callback error', err.response ? err.response.data : err.message);
    return res.status(500).send('Authentication failed');
  }
});

// Device flow start (client calls this)
app.post('/device/start', async (req, res) => {
  const scope = req.body.scope || 'read:user user:email';
  try {
    const resp = await axios.post(
      'https://github.com/login/device/code',
      new URLSearchParams({ client_id: CLIENT_ID, scope }).toString(),
      { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    // resp.data contains: device_code, user_code, verification_uri, expires_in, interval
    res.json(resp.data);
  } catch (err) {
    console.error('Device/start error', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'device_start_failed' });
  }
});

// Device flow poll: client repeatedly calls this endpoint with device_code
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
    // Possible responses:
    // - { error: 'authorization_pending' } -> keep polling
    // - { access_token, token_type, scope } -> success
    const data = resp.data;
    if (data.access_token) {
      // Optionally fetch user
      const userResp = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `token ${data.access_token}`, Accept: 'application/json', 'User-Agent': '1Quantum-Auth-Demo' }
      });
      return res.json({ success: true, tokenData: data, user: userResp.data });
    }
    // forward the error
    return res.json({ success: false, data });
  } catch (err) {
    console.error('Device/poll error', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'device_poll_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Auth server listening on port ${PORT}`);
  console.log(`Web login: http://localhost:${PORT}/login`);
});