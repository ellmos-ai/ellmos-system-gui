/* Catalogue metadata is untrusted: create only static elements and literal text. */
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

export function renderRoleSocketPreview(document, container, catalogue, provider) {
  const sockets = catalogue?.role_socket_catalog?.provider_sockets;
  const templates = Array.isArray(catalogue?.templates) ? catalogue.templates : [];
  const cards = [];
  for (const template of templates.slice(0, 12)) {
    if (!template || typeof template !== 'object' || Array.isArray(template)) continue;
    const socketId = text(template.socket_id, 'domain_specialist');
    const model = text(own(own(own(sockets, socketId), 'providers'), provider), text(provider));
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
      element(document, 'strong', model));
    card.append(heading, route, binding);
    cards.push(card);
  }
  container.replaceChildren(...cards);
}

export async function mountRoleSocketPreview(document, fetcher = globalThis.fetch) {
  const container = document.getElementById('ocean-role-socket-list');
  const select = document.getElementById('ocean-socket-provider-select');
  if (!container || !select) return;
  let catalogue = null;
  const render = () => {
    if (catalogue) renderRoleSocketPreview(document, container, catalogue, select.value);
  };
  select.addEventListener('change', render);
  try {
    const response = await fetcher('/api/agenten/library');
    if (response.ok) {
      catalogue = await response.json();
      render();
    }
  } catch {
    // An unavailable catalogue supplies no preview or execution evidence.
  }
}
