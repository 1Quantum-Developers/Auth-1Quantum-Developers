# Auth-1Quantum-Developers
```markdown
Auth service (GitHub OAuth + Device Flow)

This demo implements:
- GitHub web OAuth (redirect -> callback)
- GitHub OAuth Device Flow (device/user code + polling)

Callback URL configured for the OAuth app:
https://auth-onequantum-developers.onrender.com/callback

Environment variables
- GITHUB_CLIENT_ID (required)
- GITHUB_CLIENT_SECRET (required)
- REDIRECT_URI (optional, defaults to the callback URL above)
- PORT (optional)

Do NOT commit client secrets to the repository. Use Render / your host's secret manager.

Run locally:
1. Copy .env.example -> .env and fill in values.
2. npm install
3. npm start
4. Visit http://localhost:3000

Files:
- server.js (Express server)
- public/index.html (web OAuth start)
- public/device.html (device flow UI)
- public/app.js
- public/style.css
- .env.example
- package.json
```
