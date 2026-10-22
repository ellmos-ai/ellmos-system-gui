/* This script belongs only to the bundled connection webview. */
const form = document.getElementById('connection-form');
const input = document.getElementById('backend-url');
const allowHttp = document.getElementById('allow-loopback-http');
const button = document.getElementById('connect');
const status = document.getElementById('connection-status');

try {
  input.value = localStorage.getItem('ellmos-desktop-last-url') || '';
} catch (_) { /* The connection form also works without persistent storage. */ }

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = 'Verbindung wird vorbereitet …';
  status.dataset.state = 'connecting';
  try {
    const receipt = await window.__TAURI__.core.invoke('attach', {
      request: {url: input.value.trim(), allow_loopback_http: allowHttp.checked},
    });
    if (receipt?.schema !== 'ellmos-system-gui.desktop-attach.v1') {
      throw new Error('Die Verbindung wurde nicht eindeutig bestätigt.');
    }
    try { localStorage.setItem('ellmos-desktop-last-url', input.value.trim()); } catch (_) {}
    status.dataset.state = 'connected';
    status.textContent = receipt.contract === 'authentication_required'
      ? 'Die Anmeldung ist im App-Fenster geöffnet. Die Backendinstanz ist noch nicht verifiziert.'
      : 'Die Oberfläche ist geöffnet. Die Backend-Herkunft wird dort angezeigt.';
  } catch (error) {
    status.dataset.state = 'error';
    status.textContent = typeof error === 'string' ? error
      : error?.message || 'Die Verbindung konnte nicht geöffnet werden.';
  } finally {
    button.disabled = false;
  }
});
