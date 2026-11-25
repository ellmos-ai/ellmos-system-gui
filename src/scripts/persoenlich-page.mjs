// Client-Logik für /persoenlich — liest /api/life/overview, /api/life/providers, /api/contacts
const byId = (id) => document.getElementById(id);

const eur = (v) => {
  const num = Number(v);
  return Number.isFinite(num) ? `${num.toFixed(2).replace('.', ',')} €` : '–';
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function setStatus(text, tone = 'info') {
  const node = byId('pa-status');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  return body;
}

async function loadPersonal() {
  setStatus('Lade gemessene Life- und Kontaktdaten …');
  try {
    const [overview, providers, contactsR] = await Promise.all([
      fetch('/api/life/overview', { method: 'GET' }).then(readJson),
      fetch('/api/life/providers', { method: 'GET' }).then(readJson),
      fetch('/api/contacts', { method: 'GET' }).then(readJson),
    ]);

    const ts = overview.tasks_sequences || {};
    const rt = overview.routines || {};
    const fin = overview.finance || {};
    const sp = overview.health_energy?.spoon_budget || {};
    const cStats = contactsR.stats || {};

    byId('pa-kpi-tasks').textContent = String(ts.open_tasks ?? '–');
    byId('pa-kpi-chains').textContent = `${ts.active_sequences ?? 0} aktive Sequenzen`;
    byId('pa-kpi-routines').textContent = String(rt.due_today ?? '–');
    byId('pa-kpi-routines-meta').textContent = `${rt.active ?? 0} aktiv · ${rt.overdue ?? 0} überfällig`;
    byId('pa-kpi-spoons').textContent = sp.spoons_total != null ? `${sp.spoons_remaining ?? '–'} / ${sp.spoons_total}` : '–';
    byId('pa-kpi-spoons-status').textContent = sp.status ? `Status: ${sp.status} (lokal)` : 'Lokal gemessen';
    byId('pa-kpi-abos').textContent = eur(fin.total_abos);
    byId('pa-kpi-contacts').textContent = `${cStats.total ?? (contactsR.contacts || []).length} Kontakte gespeichert`;

    const grid = byId('pa-providers-list');
    if (grid) {
      grid.replaceChildren();
      for (const [key, info] of Object.entries(providers || {})) {
        if (!info || typeof info !== 'object') continue;
        const card = el('article', 'pa-provider-item');
        const head = el('div', 'pa-provider-head');
        head.append(el('strong', '', key));
        head.append(el('span', 'badge', info.available ? 'verbunden' : (info.status || 'offen')));
        card.append(head);
        if (info.message) card.append(el('p', '', info.message));
        grid.append(card);
      }
    }

    setStatus(`Übersicht geladen (Datenstand: ${overview.data_source || 'measured'}).`);
  } catch (err) {
    setStatus(`Persönliche Übersicht nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

byId('pa-refresh')?.addEventListener('click', () => loadPersonal());
loadPersonal();
