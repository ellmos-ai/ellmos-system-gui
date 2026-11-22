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

const updateStatus = document.getElementById('desktop-update-status');
const checkUpdate = document.getElementById('check-desktop-update');
const installUpdate = document.getElementById('install-desktop-update');
const installAction = document.getElementById('desktop-update-install-action');
let offeredVersion = null;

checkUpdate.addEventListener('click', async () => {
  checkUpdate.disabled = true;
  installAction.hidden = true;
  offeredVersion = null;
  updateStatus.textContent = 'App-Updates werden geprüft …';
  try {
    const receipt = await window.__TAURI__.core.invoke('check_desktop_update');
    if (receipt?.schema !== 'ellmos-system-gui.desktop-update.v1') throw new Error();
    if (receipt.state === 'available' && typeof receipt.offered_version === 'string' && receipt.offered_version) {
      offeredVersion = receipt.offered_version;
      updateStatus.textContent = `Version ${offeredVersion} ist verfügbar.`;
      installAction.hidden = false;
    } else if (receipt.state === 'current') {
      updateStatus.textContent = `Version ${receipt.installed_version} ist aktuell.`;
    } else if (receipt.state === 'unavailable') {
      updateStatus.textContent = 'Für diesen Build ist kein signierter Update-Kanal eingerichtet.';
    } else {
      throw new Error();
    }
  } catch (error) {
    updateStatus.textContent = typeof error === 'string' ? error : 'Die Update-Prüfung konnte nicht bestätigt werden.';
  } finally {
    checkUpdate.disabled = false;
  }
});

installUpdate.addEventListener('click', async () => {
  if (offeredVersion === null || button.disabled) return;
  const expectedVersion = offeredVersion;
  offeredVersion = null;
  installAction.hidden = true;
  checkUpdate.disabled = true;
  button.disabled = true;
  updateStatus.textContent = 'Das Update wird geladen und seine Signatur geprüft …';
  try {
    const receipt = await window.__TAURI__.core.invoke('install_desktop_update', {expectedVersion});
    if (receipt?.schema !== 'ellmos-system-gui.desktop-update.v1'
        || receipt.state !== 'installed' || receipt.offered_version !== expectedVersion) throw new Error();
    updateStatus.textContent = `Version ${expectedVersion} ist installiert. Starte die App neu.`;
  } catch (error) {
    updateStatus.textContent = typeof error === 'string' ? error : 'Die Installation konnte nicht bestätigt werden.';
  } finally {
    checkUpdate.disabled = false;
    button.disabled = false;
  }
});
