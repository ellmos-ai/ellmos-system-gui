// SPDX-License-Identifier: MIT
// Appearance metadata only: never change runtime status, text or card backgrounds.
export function normalizeAgentColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}
export function colorReadbackMatches(readback, expected) {
  return expected === undefined || readback?.color === expected;
}
export function applyAgentColor(card, profile = {}) {
  const color = normalizeAgentColor(profile.color);
  const source = color && ['instance', 'blueprint'].includes(profile.color_source)
    ? profile.color_source : 'default';
  card.style.removeProperty('border-inline-start');
  card.querySelector('[data-agent-color-note]')?.remove();
  card.dataset.agentColorSource = source;
  if (!color || source === 'default') return;
  card.style.setProperty('border-inline-start', '6px solid ' + color);
  const note = card.ownerDocument.createElement('small');
  note.dataset.agentColorNote = '';
  note.style.setProperty('color', 'var(--text-muted)');
  note.textContent = source === 'blueprint' ? 'Blueprint-Farbe' : 'Eigene Instanzfarbe';
  card.append(note);
}
if (typeof window !== 'undefined') window.BachAgentColor = {applyAgentColor, normalizeAgentColor};
