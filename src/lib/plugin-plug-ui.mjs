// DOM-Darstellung des Plugin-Kabels (nur Anzeige, kein Schalter).
import {plugState, plugAccessibleText, observedLabel} from './plugin-plug-state.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attributes = {}) => {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
};
const html = (tag, content, className) => {
  const element = document.createElement(tag);
  if (content !== undefined && content !== null) element.textContent = String(content);
  if (className) element.className = className;
  return element;
};

// Kabel-Grafik nach der Vorlage der alten Steckdosenleiste (Stecker, Kabel, LED); rein dekorativ,
// der Zustand steht zusätzlich als Text daneben.
export function cableGraphic(state) {
  const graphic = svg('svg', {viewBox: '0 0 120 40', class: 'plug-graphic', 'aria-hidden': 'true', focusable: 'false'});
  graphic.append(svg('rect', {x: 94, y: 8, width: 22, height: 24, rx: 4, class: 'plug-socket'}));
  graphic.append(svg('rect', {x: 100, y: 15, width: 3, height: 10, class: 'plug-slot'}), svg('rect', {x: 107, y: 15, width: 3, height: 10, class: 'plug-slot'}));
  const led = svg('circle', {cx: 105, cy: 12, r: 2.4, class: 'plug-led'});
  if (state === 'plugged') {
    graphic.append(svg('path', {d: 'M4 20 C 30 6, 50 34, 70 20', class: 'plug-cable'}), svg('rect', {x: 70, y: 13, width: 24, height: 14, rx: 3, class: 'plug-body'}));
  } else if (state === 'unplugged') {
    graphic.append(svg('path', {d: 'M4 20 C 12 4, 24 4, 24 18 C 24 30, 12 30, 14 20 C 16 12, 26 14, 40 20', class: 'plug-cable'}), svg('rect', {x: 40, y: 13, width: 24, height: 14, rx: 3, class: 'plug-body'}));
  } else if (state === 'unknown') {
    graphic.append(svg('path', {d: 'M4 20 C 30 6, 50 34, 70 20', class: 'plug-cable plug-dashed'}), svg('rect', {x: 56, y: 13, width: 24, height: 14, rx: 3, class: 'plug-body plug-dashed'}));
    const mark = svg('text', {x: 68, y: 24, 'text-anchor': 'middle', class: 'plug-mark'});
    mark.textContent = '?';
    graphic.append(mark);
  } else {
    graphic.append(svg('path', {d: 'M4 20 L 30 20 L 36 12 L 44 28 L 50 20 L 66 20', class: 'plug-cable'}), svg('rect', {x: 66, y: 13, width: 24, height: 14, rx: 3, class: 'plug-body'}));
    const mark = svg('text', {x: 78, y: 24, 'text-anchor': 'middle', class: 'plug-mark'});
    mark.textContent = '✕';
    graphic.append(mark);
  }
  graphic.append(led);
  return graphic;
}

export function plugCableElement(item, observedAt = new Date()) {
  const info = plugState(item);
  const name = item && typeof item === 'object' ? (item.name || item.id) : null;
  const wrapper = html('section', null, 'plug-state');
  wrapper.dataset.state = info.state;
  wrapper.setAttribute('aria-label', plugAccessibleText(name, info, observedAt));
  wrapper.title = info.headline + ' · ' + info.reason + ' ' + info.runtime;
  wrapper.append(cableGraphic(info.state), html('strong', info.headline, 'plug-headline'));
  const evidence = document.createElement('details');
  evidence.className = 'plug-evidence';
  evidence.append(html('summary', 'Beleg zum Zustand'));
  for (const line of [info.reason, 'Quelle: ' + info.source, info.scope, info.host, observedLabel(observedAt), info.runtime]) {
    if (line) evidence.append(html('p', line));
  }
  wrapper.append(evidence);
  return wrapper;
}
