// SPDX-License-Identifier: MIT
// B-08: /agenten/fabrika and /agenten/bibliothek were removed as pages; saved links keep their destination.
export const LIBRARY_HOME = '/agenten/blueprints';

export function libraryRedirectTarget(search = '') {
  const old = new URLSearchParams(search);
  const name = old.get('load') || old.get('blueprint');
  const target = new URL(LIBRARY_HOME, 'https://gui.invalid');
  if (name) target.searchParams.set('blueprint', name);
  else if (old.get('tab') === 'teams' || old.get('tab') === 'teambuilding') target.searchParams.set('tab', 'teams');
  return target.pathname + target.search;
}
