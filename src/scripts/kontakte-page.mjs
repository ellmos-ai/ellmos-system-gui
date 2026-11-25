// Client-Logik für /kontakte (liest und schreibt über /api/contacts; nur textContent)
const byId = (id) => document.getElementById(id);

let contacts = [];

function setStatus(text, tone = 'info') {
  const el = byId('knt-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function populateCategories(items) {
  const select = byId('knt-filter-cat');
  if (!select) return;
  const previous = select.value;
  const cats = [...new Set(items.map((c) => String(c.category || '').trim()).filter(Boolean))].sort();
  select.replaceChildren(new Option('Alle Kategorien', ''));
  for (const cat of cats) select.append(new Option(cat, cat));
  if (cats.includes(previous)) select.value = previous;
}

function renderList() {
  const list = byId('knt-list');
  if (!list) return;
  const query = (byId('knt-search')?.value || '').trim().toLocaleLowerCase('de');
  const cat = byId('knt-filter-cat')?.value || '';
  const filtered = contacts.filter((c) => {
    if (cat && String(c.category || '') !== cat) return false;
    if (!query) return true;
    return [c.name, c.category, c.subcategory, c.organization, c.city, c.email, c.phone, c.notes]
      .some((v) => String(v || '').toLocaleLowerCase('de').includes(query));
  });

  const count = byId('knt-count');
  if (count) count.textContent = `${filtered.length} von ${contacts.length} angezeigt`;

  list.replaceChildren();
  if (!filtered.length) {
    list.append(el('p', 'knt-empty', contacts.length ? 'Keine Kontakte passen zum aktuellen Filter.' : 'Noch keine Kontakte im Backend gespeichert.'));
    return;
  }

  for (const c of filtered) {
    const card = el('article', 'knt-card');
    const head = el('div', 'knt-card-head');
    head.append(el('h3', '', c.name || `Kontakt #${c.id ?? '?'}`));
    if (c.category) head.append(el('span', 'badge', c.category));
    card.append(head);

    const roleParts = [c.subcategory, c.organization].filter(Boolean);
    if (roleParts.length) card.append(el('p', 'knt-meta', roleParts.join(' · ')));

    const phones = [c.phone, c.phone_mobile, c.phone_work].filter(Boolean);
    if (phones.length) card.append(el('p', 'knt-meta', `Telefon: ${phones.join(' / ')}`));

    const emails = [c.email, c.email_work].filter(Boolean);
    if (emails.length) card.append(el('p', 'knt-meta', `E-Mail: ${emails.join(' / ')}`));

    const locParts = [c.street, [c.zip_code, c.city].filter(Boolean).join(' '), c.country].filter(Boolean);
    if (locParts.length) card.append(el('p', 'knt-meta', locParts.join(', ')));

    if (c.notes) card.append(el('p', 'knt-notes', c.notes));
    list.append(card);
  }
}

async function loadContacts() {
  setStatus('Kontakte werden vom Backend geladen …');
  try {
    const res = await fetch('/api/contacts', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    contacts = Array.isArray(data.contacts) ? data.contacts : [];
    const stats = data.stats || {};
    byId('knt-kpi-total').textContent = String(stats.total ?? contacts.length);
    byId('knt-kpi-health').textContent = String(stats.health ?? contacts.filter((c) => c.category === 'arzt').length);
    byId('knt-kpi-business').textContent = String(stats.business ?? 0);
    byId('knt-kpi-personal').textContent = String(stats.personal ?? 0);
    populateCategories(contacts);
    renderList();
    setStatus(`${contacts.length} Kontakte direkt aus dem Backend geladen.`);
  } catch (err) {
    contacts = [];
    renderList();
    setStatus(`Kontakte konnten nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

byId('knt-refresh')?.addEventListener('click', () => loadContacts());
byId('knt-search')?.addEventListener('input', () => renderList());
byId('knt-filter-cat')?.addEventListener('change', () => renderList());

byId('knt-toggle-form')?.addEventListener('click', () => {
  const panel = byId('knt-form-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) byId('knt-name')?.focus();
});

byId('knt-cancel')?.addEventListener('click', () => {
  const panel = byId('knt-form-panel');
  if (panel) panel.hidden = true;
});

byId('knt-create-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = byId('knt-submit');
  const fd = new FormData(form);
  const payload = {
    name: String(fd.get('name') || '').trim(),
    category: String(fd.get('category') || 'personal').trim(),
    subcategory: String(fd.get('subcategory') || '').trim() || null,
    organization: String(fd.get('organization') || '').trim() || null,
    phone: String(fd.get('phone') || '').trim() || null,
    email: String(fd.get('email') || '').trim() || null,
    notes: String(fd.get('notes') || '').trim() || null,
  };
  if (!payload.name) return;
  if (submit) submit.disabled = true;
  setStatus('Speichere Kontakt …');
  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    }
    form.reset();
    const panel = byId('knt-form-panel');
    if (panel) panel.hidden = true;
    await loadContacts();
    setStatus(`Kontakt „${payload.name}“ gespeichert und über Rücklesung bestätigt.`);
  } catch (err) {
    setStatus(`Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
});

loadContacts();
