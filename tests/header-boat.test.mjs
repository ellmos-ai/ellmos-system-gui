import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOAT_MODE_KEY,
  BOAT_MODES,
  DEFAULT_BOAT_MODE,
  SINK_CLICK_THRESHOLD,
  SINK_WINDOW_MS,
  normalizeBoatMode,
  parseBoatMode,
  boatModeBehavior,
  boatModeFlags,
  recordBoatClick,
  createBoatClickTracker,
} from '../src/lib/header-boat.mjs';

test('unknown or invalid mode values fall back to "on"', () => {
  assert.equal(BOAT_MODE_KEY, 'bach-boat-mode');
  assert.deepEqual(BOAT_MODES, ['on', 'off', 'logo']);
  assert.equal(DEFAULT_BOAT_MODE, 'on');

  for (const unknown of [undefined, null, '', '   ', 'unknown', 'auto', 'sunk', 'true', 0, 1, {}, [], NaN]) {
    assert.equal(normalizeBoatMode(unknown), 'on', `expected "on" for ${String(unknown)}`);
    assert.equal(parseBoatMode(unknown), 'on');
  }

  assert.equal(normalizeBoatMode('on'), 'on');
  assert.equal(normalizeBoatMode('off'), 'off');
  assert.equal(normalizeBoatMode('logo'), 'logo');
  assert.equal(normalizeBoatMode(' LOGO '), 'logo');
  assert.equal(normalizeBoatMode('OFF'), 'off');
});

test('3 clicks within 2 seconds trigger sink', () => {
  assert.equal(SINK_CLICK_THRESHOLD, 3);
  assert.equal(SINK_WINDOW_MS, 2000);

  const tracker = createBoatClickTracker();
  const c1 = tracker.click(1000);
  assert.equal(c1.count, 1);
  assert.equal(c1.sunk, false);
  assert.equal(c1.shouldSink, false);

  const c2 = tracker.click(1800);
  assert.equal(c2.count, 2);
  assert.equal(c2.sunk, false);

  const c3 = tracker.click(2900); // 1900 ms after first click (<= 2000 ms)
  assert.equal(c3.count, 3);
  assert.equal(c3.sunk, true);
  assert.equal(c3.shouldSink, true);
  assert.equal(tracker.isSunk(), true);

  // Boundary: exactly 2000 ms span also sinks
  let state = recordBoatClick([], 5000);
  state = recordBoatClick(state.timestamps, 6000);
  state = recordBoatClick(state.timestamps, 7000);
  assert.equal(state.sunk, true);
  assert.equal(state.count, 3);
});

test('3 clicks spread over more than 2 seconds do not sink', () => {
  const tracker = createBoatClickTracker();
  assert.equal(tracker.click(1000).sunk, false);
  assert.equal(tracker.click(2200).sunk, false);
  // 3rd click at 3001 ms is 2001 ms after the 1st click (> 2000 ms), so the 1st click expired
  const third = tracker.click(3001);
  assert.equal(third.sunk, false);
  assert.equal(third.shouldSink, false);
  assert.equal(third.count, 2);
  assert.equal(tracker.isSunk(), false);

  // Widely spaced clicks never accumulate to 3
  const slow = createBoatClickTracker();
  assert.equal(slow.click(0).sunk, false);
  assert.equal(slow.click(1500).sunk, false);
  assert.equal(slow.click(3100).sunk, false);
  assert.equal(slow.click(4700).sunk, false);
  assert.equal(slow.isSunk(), false);
});

test('mode "on", "off" and "logo" behaviour flags and reduced-motion / sunk overrides', () => {
  const on = boatModeBehavior('on');
  assert.equal(on.mode, 'on');
  assert.equal(on.label, 'An');
  assert.equal(on.visible, true);
  assert.equal(on.hidden, false);
  assert.equal(on.animated, true);
  assert.equal(on.staticLogo, false);
  assert.equal(on.alignedToLogo, false);
  assert.equal(on.standingStill, false);
  assert.equal(on.showRestore, false);

  const off = boatModeFlags('off');
  assert.equal(off.mode, 'off');
  assert.equal(off.label, 'Aus');
  assert.equal(off.visible, false);
  assert.equal(off.hidden, true);
  assert.equal(off.animated, false);
  assert.equal(off.staticLogo, false);
  assert.equal(off.canSink, false);
  assert.equal(off.showRestore, false);

  const logo = boatModeBehavior('logo');
  assert.equal(logo.mode, 'logo');
  assert.equal(logo.label, 'Logo');
  assert.equal(logo.visible, true);
  assert.equal(logo.hidden, false);
  assert.equal(logo.animated, false);
  assert.equal(logo.staticLogo, true);
  assert.equal(logo.alignedToLogo, true);
  assert.equal(logo.standingStill, true);
  assert.equal(logo.canSink, true);

  // Reduced motion disables animation even in "on" mode
  const onReduced = boatModeBehavior('on', { reducedMotion: true });
  assert.equal(onReduced.visible, true);
  assert.equal(onReduced.animated, false);
  assert.equal(onReduced.standingStill, true);

  // Sunk state hides the boat for the session and exposes restore link (unless mode is "off")
  const sunkOn = boatModeBehavior('on', { sunk: true });
  assert.equal(sunkOn.visible, false);
  assert.equal(sunkOn.hidden, true);
  assert.equal(sunkOn.animated, false);
  assert.equal(sunkOn.sunk, true);
  assert.equal(sunkOn.showRestore, true);

  const sunkOff = boatModeBehavior('off', { sunk: true });
  assert.equal(sunkOff.visible, false);
  assert.equal(sunkOff.showRestore, false);
});
