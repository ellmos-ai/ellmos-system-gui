// Pure logic for the interactive header paper boat (PB-25 item 13).
// Mode is persisted in localStorage under "bach-boat-mode" ("on" | "off" | "logo", default "on").
// Clicking the boat 3 times within 2 seconds (2000 ms) sinks it for the rest of the page session.

export const BOAT_MODE_KEY = 'bach-boat-mode';
export const BOAT_MODES = Object.freeze(['on', 'off', 'logo']);
export const DEFAULT_BOAT_MODE = 'on';
export const SINK_CLICK_THRESHOLD = 3;
export const SINK_WINDOW_MS = 2000;

export const BOAT_MODE_LABELS = Object.freeze({
  on: 'An',
  off: 'Aus',
  logo: 'Logo',
});

/**
 * Normalizes a raw mode value to one of "on" | "off" | "logo".
 * Unknown or missing values fall back to "on".
 */
export function normalizeBoatMode(value) {
  if (typeof value !== 'string') return DEFAULT_BOAT_MODE;
  const trimmed = value.trim().toLowerCase();
  return BOAT_MODES.includes(trimmed) ? trimmed : DEFAULT_BOAT_MODE;
}

export const parseBoatMode = normalizeBoatMode;

/**
 * Computes behaviour flags for a given boat mode, session sunk state, and reduced-motion preference.
 */
export function boatModeBehavior(mode, options = {}) {
  const normalized = normalizeBoatMode(mode);
  const sunk = Boolean(options?.sunk);
  const reducedMotion = Boolean(options?.reducedMotion);
  const visible = normalized !== 'off' && !sunk;
  const hidden = !visible;
  const staticLogo = normalized === 'logo';
  const animated = normalized === 'on' && !sunk && !reducedMotion;
  return {
    mode: normalized,
    label: BOAT_MODE_LABELS[normalized],
    visible,
    hidden,
    animated,
    staticLogo,
    alignedToLogo: staticLogo,
    standingStill: staticLogo || reducedMotion,
    sunk: normalized !== 'off' && sunk,
    canSink: visible,
    showRestore: normalized !== 'off' && sunk,
  };
}

export const boatModeFlags = boatModeBehavior;

/**
 * Pure click-window evaluator: given previous click timestamps (ms) and current timestamp `nowMs`,
 * keeps only clicks within `windowMs` (default 2000 ms) and checks if `threshold` (default 3) is reached.
 */
export function recordBoatClick(
  timestamps = [],
  nowMs = Date.now(),
  windowMs = SINK_WINDOW_MS,
  threshold = SINK_CLICK_THRESHOLD,
) {
  const safeNow = Number.isFinite(nowMs) ? nowMs : 0;
  const prior = Array.isArray(timestamps) ? timestamps : [];
  const recent = prior.filter(
    (t) => typeof t === 'number' && Number.isFinite(t) && safeNow >= t && safeNow - t <= windowMs,
  );
  recent.push(safeNow);
  const sunk = recent.length >= threshold;
  return {
    timestamps: recent,
    count: recent.length,
    sunk,
    shouldSink: sunk,
  };
}

/**
 * Stateful tracker for boat clicks within the 2-second window.
 */
export function createBoatClickTracker({
  windowMs = SINK_WINDOW_MS,
  threshold = SINK_CLICK_THRESHOLD,
} = {}) {
  let timestamps = [];
  let sunk = false;

  return {
    click(nowMs = Date.now()) {
      if (sunk) {
        return { timestamps: [...timestamps], count: timestamps.length, sunk: true, shouldSink: false };
      }
      const result = recordBoatClick(timestamps, nowMs, windowMs, threshold);
      timestamps = result.timestamps;
      if (result.sunk) {
        sunk = true;
      }
      return result;
    },
    reset() {
      timestamps = [];
      sunk = false;
    },
    isSunk() {
      return sunk;
    },
    getTimestamps() {
      return [...timestamps];
    },
  };
}
