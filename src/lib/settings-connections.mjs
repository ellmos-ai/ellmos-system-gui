// Read-only interpretation of the existing backend-origin observation.
export function describeBackendOrigin(data) {
  const valid = data && !Array.isArray(data) && data.schema === 'ellmos-system-gui.backend-origin.v1';
  const verified = valid && ['connection_verified', 'schema_verified', 'instance_verified', 'adapter_binding_verified']
    .every(key => data[key] === true) && ['server', 'local'].includes(data.mode);
  const observedAt = valid && typeof data.observed_at === 'string' && Number.isFinite(Date.parse(data.observed_at))
    ? data.observed_at : null;
  const label = verified && typeof data.instance_label === 'string' && data.instance_label.trim().length <= 40
    ? data.instance_label.trim() : '';
  return {
    verified: Boolean(verified),
    summary: verified ? 'Backend bestätigt · ' + (data.mode === 'server' ? 'Server' : 'Lokal') : 'Backend-Herkunft nicht bestätigt',
    instance: label ? 'Bestätigte Instanz: ' + label : 'Instanz noch nicht bestätigt',
    observed: observedAt ? 'Beobachtung des Backends: ' + observedAt : 'Noch kein Prüfzeitpunkt',
  };
}

// Keep every existing settings section reachable by keyboard and URL.
export function setupSettingsTabs(doc, win) {
  const buttons = [...doc.querySelectorAll('.tab-btn')];
  const panes = [...doc.querySelectorAll('.tab-pane')];
  function select(key, { navigate = false, focus = false } = {}) {
    const chosen = buttons.find(button => button.dataset.tab === key);
    if (!chosen || !doc.getElementById('pane-' + key)) return false;
    for (const button of buttons) {
      const active = button === chosen;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const pane of panes) {
      const active = pane.id === 'pane-' + key;
      pane.classList.toggle('active', active);
      pane.hidden = !active;
    }
    if (navigate) {
      const url = new URL(win.location.href);
      if (url.searchParams.get('tab') !== key) {
        url.searchParams.set('tab', key);
        win.history.pushState(null, '', url);
      }
    }
    if (focus) chosen.focus();
    return true;
  }
  function selectFromUrl() {
    const key = new URL(win.location.href).searchParams.get('tab');
    if (!select(key)) select('connections');
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(button.dataset.tab, { navigate: true }));
    button.addEventListener('keydown', event => {
      const target = event.key === 'ArrowRight' ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (target === null || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      select(buttons[target].dataset.tab, { navigate: true, focus: true });
    });
  });
  win.addEventListener('popstate', selectFromUrl);
  selectFromUrl();
}
