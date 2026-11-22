/* Catalogue metadata is untrusted: create only static elements and literal text. */
const PAGE_SIZE = 12;
const isModuleRole = (template) => template?.source === 'module_manifest_role';
const text = (value, fallback = '') => typeof value === 'string' && value ? value : fallback;

function own(object, key) {
  return object && typeof object === 'object' && !Array.isArray(object)
    && Object.hasOwn(object, key) ? object[key] : undefined;
}

function element(document, tag, value) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  return node;
}

function detail(document) {
  const node = element(document, 'div');
  Object.assign(node.style, {marginTop: '0.25rem', color: 'var(--text-muted)'});
  return node;
}

// Module roles = catalogue entries that come from a module manifest. No list, no number.
export function countModuleRoles(catalogue) {
  const templates = catalogue?.templates;
  if (!Array.isArray(templates)) return null;
  return templates.filter(isModuleRole).length;
}

export function renderRoleSocketPreview(document, container, catalogue, provider, {modulesOnly = false, limit = PAGE_SIZE} = {}) {
  const sockets = catalogue?.role_socket_catalog?.provider_sockets;
  const templates = (Array.isArray(catalogue?.templates) ? catalogue.templates : [])
    .filter(template => template && typeof template === 'object' && !Array.isArray(template))
    .filter(template => !modulesOnly || isModuleRole(template));
  const cards = [];
  for (const template of templates.slice(0, limit)) {
    const socketId = text(template.socket_id, 'domain_specialist');
    const supported = !Array.isArray(template.providers) || template.providers.includes(provider);
    const model = supported ? own(own(own(sockets, socketId), 'providers'), provider) : undefined;
    const card = element(document, 'div');
    Object.assign(card.style, {padding: '0.65rem', border: '1px solid var(--border)',
      borderRadius: '8px', background: 'var(--bg-dark)'});
    const heading = element(document, 'div');
    Object.assign(heading.style, {display: 'flex', justifyContent: 'space-between', gap: '0.4rem'});
    const title = element(document, 'strong', text(template.label, text(template.role_id, 'Rolle')));
    const badge = element(document, 'span', template.source === 'module_manifest_role'
      ? '📦 ' + text(template.module_id) : '🧭 ' + text(template.tier, 'role'));
    badge.className = 'studio-state';
    heading.append(title, badge);

    const route = detail(document);
    route.append(text(template.semantic_route) ? 'Umbrella: ' : 'Prompt: ',
      element(document, 'code', text(template.semantic_route, text(template.prompt, 'SKILL.md'))));
    const binding = detail(document);
    binding.append('Sockel ', element(document, 'code', socketId), ' → ',
      element(document, 'strong', text(model, 'Keine Modellbindung')));
    card.append(heading, route, binding);
    cards.push(card);
  }
  container.replaceChildren(...cards);
  return templates.length;
}

export async function mountRoleSocketPreview(document, fetcher = globalThis.fetch) {
  const container = document.getElementById('ocean-role-socket-list');
  const select = document.getElementById('ocean-socket-provider-select');
  if (!container || !select) return;
  const source = document.getElementById('ocean-role-source-select');
  const more = document.getElementById('ocean-role-show-more');
  let catalogue = null;
  let limit = PAGE_SIZE;
  const render = () => {
    if (!catalogue) return;
    const total = renderRoleSocketPreview(document, container, catalogue, select.value, {
      modulesOnly: source?.value === 'module', limit,
    });
    if (more) more.hidden = total <= limit;
  };
  const count = document.getElementById('ocean-module-role-count');
  if (count) count.textContent = '';
  select.addEventListener('change', render);
  source?.addEventListener('change', () => {
    limit = PAGE_SIZE;
    render();
  });
  more?.addEventListener('click', () => {
    const firstNewIndex = limit;
    limit += PAGE_SIZE;
    render();
    const firstNewRole = container.children[firstNewIndex];
    if (firstNewRole) {
      firstNewRole.tabIndex = -1;
      firstNewRole.focus();
    }
  });
  try {
    const response = await fetcher('/api/agenten/library');
    if (response.ok) {
      catalogue = await response.json();
      const roles = countModuleRoles(catalogue);
      if (count && roles !== null) count.textContent = roles + ' ';
      render();
    }
  } catch {
    // An unavailable catalogue supplies no preview or execution evidence.
  }
}
