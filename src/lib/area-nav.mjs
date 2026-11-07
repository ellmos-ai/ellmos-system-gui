// SPDX-License-Identifier: MIT
// One place for the navigation logic: which area a page belongs to, which entry is current, which way back a
// cross-area link offers. Used by the layout (area navigation), the sidebar (Header.astro) and the tests.
const ORIGIN = 'https://gui.invalid';
const normalizePath = (value) => value.replace(/\/+$/, '') || '/';

function parts(href, search = '') {
  const url = new URL(href, ORIGIN);
  if (search) url.search = search;
  return {path: normalizePath(url.pathname), params: url.searchParams};
}

export const pathOf = (href) => parts(href).path;

const isSubset = (wanted, have) => [...wanted].every(([key, value]) => have.get(key) === value);
const sizeOf = (params) => [...params].length;
const underPath = (parent, path) => parent !== '/' && path.startsWith(parent + '/');

// The archived-sessions inbox tab is the same place as the message page.
function current(pathname, search) {
  const now = parts(pathname, search);
  if (now.path === '/agenten/sessions' && now.params.get('tab') === 'inbox') return parts('/user-inbox');
  return now;
}

const beats = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; }; // first entry wins a tie

// Exact match of path and the complete query (pinned domain links).
export function matchesExact(href, pathname, search = '') {
  if (!href || href === '#') return false;
  const target = parts(href);
  const now = parts(pathname, search);
  return target.path === now.path && sizeOf(target.params) === sizeOf(now.params) && isSubset(target.params, now.params);
}

// items: [{id, href, default?}]. Returns the id of the ONE best entry or null.
// Rank: same path before parent path, deeper parent before shallower, more matching query parameters first, then order.
export function resolveActiveItem(items, pathname, search = '') {
  const now = current(pathname, search);
  let best = null;
  items.forEach((item) => {
    if (!item.href || item.href === '#') return;
    const target = parts(item.href);
    const samePath = target.path === now.path;
    if (!samePath && !underPath(target.path, now.path)) return;
    if (!isSubset(target.params, now.params)) return;
    const rank = [samePath ? 1 : 0, target.path.length, sizeOf(target.params)];
    if (!best || beats(rank, best.rank)) best = {id: item.id, rank};
  });
  return best?.id ?? null;
}

// Sidebar marking: the best entry for the page; a page of an area without its own sidebar entry (classic preset has
// no "Ketten") marks the entry of the area's home page instead, so one entry is always marked.
export function resolveSidebarActive(items, areas, pathname, search = '') {
  const found = resolveActiveItem(items, pathname, search);
  if (found) return found;
  const area = areaForPath(areas, pathname);
  if (!area) return null;
  const home = parts(area.home);
  return resolveActiveItem(items, home.path, '?' + home.params.toString());
}

export function areaForPath(areas, pathname) {
  const path = normalizePath(pathname || '/');
  for (const area of areas) if (area.entries.some((entry) => pathOf(entry.href) === path)) return area;
  for (const area of areas) if ((area.paths || []).some((prefix) => path === prefix || underPath(prefix, path))) return area;
  return null;
}

// Entries of one area with the current one marked. A page that is part of the area but no entry (a foreign settings
// tab) marks nothing; the entry flagged `default` stands for the bare path (/settings opens "Verbindungen").
export function areaNavModel(area, pathname, search = '') {
  const id = resolveActiveItem(area.entries, pathname, search);
  const now = current(pathname, search);
  let chosen = id;
  if (!chosen) {
    const fallback = area.entries.find((entry) => {
      const target = parts(entry.href);
      return entry.default === true && target.path === now.path && [...target.params.keys()].every((key) => !now.params.has(key));
    });
    chosen = fallback?.id ?? null;
  }
  return {
    id: area.id,
    label: area.label,
    ariaLabel: area.aria_label || area.label,
    entries: area.entries.map((entry) => ({...entry, current: entry.id === chosen})),
  };
}

// ?from=<area id> on a cross-area link: the way back may only lead to a configured area home.
export function breadcrumbFor(areas, from) {
  if (typeof from !== 'string') return null;
  const area = areas.find((entry) => entry.id === from);
  return area ? {id: area.id, label: area.label, href: area.home} : null;
}
