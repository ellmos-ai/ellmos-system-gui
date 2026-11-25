// Pure logic for the header paper boat (PB-25 item 13).
// Mode lives in localStorage under BOAT_MODE_KEY ("on" | "off" | "logo", default "on").
// Three clicks within two seconds sink the boat until the browser session ends.

export const BOAT_MODE_KEY = 'bach-boat-mode';
export const BOAT_MODES = Object.freeze(['on', 'off', 'logo']);
export const SINK_CLICK_THRESHOLD = 3;
export const SINK_WINDOW_MS = 2000;

// Anything that is not one of the three modes means "on".
export function normalizeBoatMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return BOAT_MODES.includes(mode) ? mode : 'on';
}

// Keeps the clicks inside the window, adds this one, and reports whether the boat sinks.
export function recordBoatClick(timestamps, now, windowMs = SINK_WINDOW_MS, threshold = SINK_CLICK_THRESHOLD) {
  const recent = timestamps.filter(t => now - t <= windowMs);
  recent.push(now);
  return {timestamps: recent, sunk: recent.length >= threshold};
}

// Wires the boat in the header (markup: Header.astro). Visibility is pure CSS on
// #header-ocean-waterline[data-boat-mode][data-boat-sunk]; window.bachBoatMode is the setting's entry point.
export function initializeHeaderBoat() {
  const sunkKey = 'bach-boat-sunk-session';
  const line = document.getElementById('header-ocean-waterline');
  const restore = document.getElementById('header-boat-restore-btn');
  // Storage can throw (private mode, blocked cookies); the boat then simply behaves as "on".
  const getStored = (store, key) => { try { return store.getItem(key); } catch { return null; } };
  const setStored = (store, key, value) => { try { value === null ? store.removeItem(key) : store.setItem(key, value); } catch { /* not persisted */ } };
  let clicks = [];
  let sinkTimer = 0;

  function render() {
    const mode = normalizeBoatMode(getStored(localStorage, BOAT_MODE_KEY));
    const sunk = getStored(sessionStorage, sunkKey) === '1';
    if (line) { line.dataset.boatMode = mode; line.dataset.boatSunk = String(sunk); delete line.dataset.boatSinking; }
    if (restore) restore.hidden = !sunk || mode === 'off';
    window.dispatchEvent(new CustomEvent('bach-boat-mode-change', {detail: {mode, sunk}}));
  }
  function raise() {
    clearTimeout(sinkTimer);
    clicks = [];
    setStored(sessionStorage, sunkKey, null);
    render();
  }

  window.bachBoatMode = {
    get: () => normalizeBoatMode(getStored(localStorage, BOAT_MODE_KEY)),
    set: value => { setStored(localStorage, BOAT_MODE_KEY, normalizeBoatMode(value)); raise(); },
  };
  document.getElementById('header-paper-boat-btn')?.addEventListener('click', () => {
    if (!line || line.dataset.boatSunk === 'true' || line.dataset.boatSinking) return;
    const click = recordBoatClick(clicks, Date.now());
    clicks = click.sunk ? [] : click.timestamps;
    if (!click.sunk) return;
    const finish = () => { setStored(sessionStorage, sunkKey, '1'); render(); };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    line.dataset.boatSinking = 'true';
    sinkTimer = setTimeout(finish, 650); // length of the paperBoatSink animation
  });
  restore?.addEventListener('click', () => { raise(); document.getElementById('header-paper-boat-btn')?.focus({preventScroll: true}); });
  render();
}
