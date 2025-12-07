// Device flow client logic
const startBtn = document.getElementById('startBtn');
const deviceInfo = document.getElementById('deviceInfo');
const userCodeEl = document.getElementById('userCode');
const verificationUriEl = document.getElementById('verificationUri');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

let deviceCode = null;
let intervalMs = 5000;
let pollTimer = null;

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusEl.textContent = 'starting...';
  try {
    const resp = await fetch('/device/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await resp.json();
    if (data.error) {
      statusEl.textContent = 'error starting device flow';
      resultEl.textContent = JSON.stringify(data, null, 2);
      startBtn.disabled = false;
      return;
    }
    deviceCode = data.device_code;
    userCodeEl.textContent = data.user_code;
    verificationUriEl.textContent = data.verification_uri;
    verificationUriEl.href = data.verification_uri;
    deviceInfo.style.display = 'block';
    statusEl.textContent = 'waiting for user to authorize';
    intervalMs = (data.interval && Number(data.interval) * 1000) || 5000;
    // start polling
    pollTimer = setInterval(pollOnce, intervalMs);
    // also do an immediate poll after a short delay
    setTimeout(pollOnce, 1000);
  } catch (err) {
    statusEl.textContent = 'start failed';
    resultEl.textContent = String(err);
    startBtn.disabled = false;
  }
});

async function pollOnce() {
  if (!deviceCode) return;
  statusEl.textContent = 'polling...';
  try {
    const resp = await fetch('/device/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode })
    });
    const data = await resp.json();
    // success -> data.success === true
    if (data.success) {
      clearInterval(pollTimer);
      statusEl.textContent = 'authorized!';
      resultEl.textContent = JSON.stringify(data, null, 2);
      // Optionally show user info
      startBtn.disabled = false;
      return;
    } else {
      // data.data may contain error like 'authorization_pending' or 'slow_down'
      if (data.data && data.data.error) {
        const err = data.data.error;
        if (err === 'authorization_pending') {
          statusEl.textContent = 'waiting for user to authorize...';
          // continue polling
        } else if (err === 'slow_down') {
          statusEl.textContent = 'slow down (increasing interval)';
          // increase interval
          clearInterval(pollTimer);
          intervalMs = intervalMs + 5000;
          pollTimer = setInterval(pollOnce, intervalMs);
        } else if (err === 'expired_token') {
          statusEl.textContent = 'device code expired';
          clearInterval(pollTimer);
          resultEl.textContent = JSON.stringify(data, null, 2);
          startBtn.disabled = false;
        } else {
          statusEl.textContent = 'error: ' + err;
          clearInterval(pollTimer);
          resultEl.textContent = JSON.stringify(data, null, 2);
          startBtn.disabled = false;
        }
      } else {
        statusEl.textContent = 'poll response: ' + JSON.stringify(data);
        // keep polling unless there's an error
      }
    }
  } catch (err) {
    statusEl.textContent = 'poll failed';
    resultEl.textContent = String(err);
    clearInterval(pollTimer);
    startBtn.disabled = false;
  }
}