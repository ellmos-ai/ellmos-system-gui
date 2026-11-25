// Client-Logik für /gesundheit — liest /api/life/providers, /api/life/overview und /api/contacts (Arztkontakte)
const byId = (id) => document.getElementById(id);

let doctors = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function setStatus(text, tone = 'info') {
  const node = byId('gh-status');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function renderDoctors() {
  const list = byId('gh-doctors-list');
  if (!list) return;
  const q = (byId('gh-search')?.value || '').trim().toLocaleLowerCase('de');
  const filtered = doctors.filter((c) => !q || [c.name, c.subcategory, c.organization, c.city, c.notes]
    .some((v) => String(v || '').toLocaleLowerCase('de').includes(q)));
  list.replaceChildren();
  if (!filtered.length) {
    list.append(el('p', 'gh-meta', doctors.length ? 'Keine Arztkontakte passen zum Filter.' : 'Keine medizinischen Kontakte im Adressbuch gefunden.'));
    return;
  }
  for (const c of filtered) {
    const card = el('article', 'gh-card');
    const head = el('div', 'gh-card-head');
    head.append(el('strong', '', c.name || `Kontakt #${c.id ?? '?'}`));
    if (c.subcategory) head.append(el('span', 'badge', c.subcategory));
    card.append(head);
    if (c.organization) card.append(el('p', 'gh-meta', c.organization));
    const reach = [c.phone, c.phone_work, c.email].filter(Boolean);
    if (reach.length) card.append(el('p', 'gh-meta', reach.join(' · ')));
    if (c.notes) card.append(el('p', 'gh-meta', c.notes));
    list.append(card);
  }
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  return body;
}

async function loadHealth() {
  setStatus('Lade Gesundheitsstatus und Arztkontakte …');
  try {
    const [providers, overview, contactsR] = await Promise.all([
      fetch('/api/life/providers', { method: 'GET' }).then(readJson),
      fetch('/api/life/overview', { method: 'GET' }).then(readJson),
      fetch('/api/contacts', { method: 'GET' }).then(readJson),
    ]);

    const hp = providers.health || {};
    byId('gh-provider-badge').textContent = hp.available ? 'verbunden' : (hp.status || 'in Arbeit');
    byId('gh-provider-message').textContent = hp.message || 'Für Vitalwerte und Medikamente ist derzeit kein Fachadapter angebunden.';

    const sp = overview.health_energy?.spoon_budget || {};
    byId('gh-kpi-spoons').textContent = sp.spoons_total != null ? `${sp.spoons_remaining ?? '–'} / ${sp.spoons_total}` : '–';
    byId('gh-kpi-spoons-status').textContent = sp.status ? `Status: ${sp.status} (nur lokal)` : 'Keine Energie-Daten';

    const allContacts = Array.isArray(contactsR.contacts) ? contactsR.contacts : [];
    doctors = allContacts.filter((c) => c.category === 'arzt' || c.source === 'health_contacts');
    byId('gh-kpi-doctors').textContent = String(doctors.length);

    renderDoctors();
    setStatus(`Gemessener Stand geladen: ${doctors.length} Arztkontakte; Fachadapter Gesundheit ist ${hp.available ? 'verbunden' : 'nicht verbunden'}.`);
  } catch (err) {
    renderDoctors();
    setStatus(`Gesundheitsdaten konnten nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

byId('gh-refresh')?.addEventListener('click', () => loadHealth());
byId('gh-search')?.addEventListener('input', () => renderDoctors());
loadHealth();
