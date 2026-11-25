// Client-Logik für /financial — liest reale BACH-Finanz-APIs via DOM-Textknoten
const byId = (id) => document.getElementById(id);

const state = {
  activeTab: 'contracts',
  contracts: [],
  insurances: [],
  deadlines: [],
  credits: [],
  bankAccounts: [],
};

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
  const node = byId('fin-status');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function matchesQuery(fields, query) {
  if (!query) return true;
  return fields.some((v) => String(v || '').toLocaleLowerCase('de').includes(query));
}

function renderPanels() {
  const q = (byId('fin-search')?.value || '').trim().toLocaleLowerCase('de');

  // Contracts
  const pContracts = byId('fin-panel-contracts');
  if (pContracts) {
    pContracts.replaceChildren();
    const list = state.contracts.filter((c) => matchesQuery([c.name, c.anbieter, c.kategorie, c.kuendigungs_status], q));
    if (!list.length) {
      pContracts.append(el('p', 'fin-empty', state.contracts.length ? 'Keine Verträge passend zum Filter.' : 'Keine Verträge gespeichert.'));
    } else {
      for (const c of list) {
        const card = el('article', 'fin-card');
        const head = el('div', 'fin-card-head');
        head.append(el('h3', '', c.name || 'Vertrag'));
        if (c.kuendigungs_status) head.append(el('span', 'badge', c.kuendigungs_status));
        card.append(head);
        card.append(el('p', 'fin-meta', [c.anbieter, c.kategorie].filter(Boolean).join(' · ') || 'Ohne Anbieter'));
        if (c.betrag != null) card.append(el('p', 'fin-amount', `${eur(c.betrag)} / ${c.intervall || 'Zeitraum offen'}`));
        if (c.naechste_zahlung || c.ablauf_datum) {
          card.append(el('p', 'fin-meta', [c.naechste_zahlung ? `Nächste Zahlung: ${c.naechste_zahlung}` : '', c.ablauf_datum ? `Ablauf: ${c.ablauf_datum}` : ''].filter(Boolean).join(' · ')));
        }
        pContracts.append(card);
      }
    }
  }

  // Insurances
  const pIns = byId('fin-panel-insurances');
  if (pIns) {
    pIns.replaceChildren();
    const list = state.insurances.filter((i) => matchesQuery([i.tarif_name, i.anbieter, i.sparte, i.steuer_relevant_typ, i.police_nr], q));
    if (!list.length) {
      pIns.append(el('p', 'fin-empty', state.insurances.length ? 'Keine Versicherungen passend zum Filter.' : 'Keine Versicherungen gespeichert.'));
    } else {
      for (const i of list) {
        const card = el('article', 'fin-card');
        const head = el('div', 'fin-card-head');
        head.append(el('h3', '', i.tarif_name || i.sparte || 'Versicherung'));
        if (i.status) head.append(el('span', 'badge', i.status));
        card.append(head);
        card.append(el('p', 'fin-meta', [i.anbieter, i.sparte, i.police_nr ? `Police ${i.police_nr}` : ''].filter(Boolean).join(' · ')));
        if (i.beitrag != null) card.append(el('p', 'fin-amount', `${eur(i.beitrag)} (${i.zahlweise || 'Beitrag'})`));
        if (i.steuer_relevant_typ) card.append(el('p', 'fin-meta', `Steuer-Kategorie: ${i.steuer_relevant_typ}`));
        if (i.ablauf_datum) card.append(el('p', 'fin-meta', `Ablauf: ${i.ablauf_datum}`));
        pIns.append(card);
      }
    }
  }

  // Deadlines
  const pDead = byId('fin-panel-deadlines');
  if (pDead) {
    pDead.replaceChildren();
    const list = state.deadlines.filter((d) => matchesQuery([d.name, d.type, d.deadline, d.ablauf], q));
    if (!list.length) {
      pDead.append(el('p', 'fin-empty', state.deadlines.length ? 'Keine Fristen passend zum Filter.' : 'Keine offenen Fristen gemeldet.'));
    } else {
      for (const d of list) {
        const card = el('article', 'fin-card');
        if (d.severity) card.dataset.severity = d.severity;
        const head = el('div', 'fin-card-head');
        head.append(el('h3', '', d.name || 'Frist'));
        head.append(el('span', 'badge', d.type || 'Frist'));
        card.append(head);
        card.append(el('p', 'fin-meta', `Frist: ${d.deadline || '–'} · Ablauf: ${d.ablauf || '–'}`));
        if (d.days_left != null) {
          card.append(el('p', 'fin-amount', d.days_left < 0 ? `${Math.abs(d.days_left)} Tage überfällig` : `Noch ${d.days_left} Tage`));
        }
        pDead.append(card);
      }
    }
  }

  // Credits & Bank accounts
  const pAcc = byId('fin-panel-accounts');
  if (pAcc) {
    pAcc.replaceChildren();
    const rows = [
      ...state.credits.map((c) => ({ kind: 'Kredit', title: c.name || c.kreditgeber || 'Kredit', sub: c.kreditgeber || '', amount: c.restschuld ?? c.rate })),
      ...state.bankAccounts.map((b) => ({ kind: 'Bankkonto', title: b.name || b.bank_name || 'Konto', sub: b.iban_masked || b.bank_name || '', amount: b.balance })),
    ].filter((r) => matchesQuery([r.kind, r.title, r.sub], q));
    if (!rows.length) {
      pAcc.append(el('p', 'fin-empty', 'Keine Kredite oder Bankkonten im Backend hinterlegt.'));
    } else {
      for (const r of rows) {
        const card = el('article', 'fin-card');
        const head = el('div', 'fin-card-head');
        head.append(el('h3', '', r.title), el('span', 'badge', r.kind));
        card.append(head);
        if (r.sub) card.append(el('p', 'fin-meta', r.sub));
        if (r.amount != null) card.append(el('p', 'fin-amount', eur(r.amount)));
        pAcc.append(card);
      }
    }
  }
}

function selectTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.fin-tab').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.finTab === tab));
  });
  for (const name of ['contracts', 'insurances', 'deadlines', 'accounts']) {
    const panel = byId(`fin-panel-${name}`);
    if (panel) panel.hidden = name !== tab;
  }
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  return body;
}

async function loadAll() {
  setStatus('Lade Finanzdaten vom Backend …');
  try {
    const [statusR, summaryR, contractsR, insR, deadR, credR, bankR] = await Promise.all([
      fetch('/api/financial/status', { method: 'GET' }).then(readJson),
      fetch('/api/financial/summary', { method: 'GET' }).then(readJson),
      fetch('/api/financial/contracts', { method: 'GET' }).then(readJson),
      fetch('/api/financial/insurances', { method: 'GET' }).then(readJson),
      fetch('/api/financial/deadlines', { method: 'GET' }).then(readJson),
      fetch('/api/financial/credits', { method: 'GET' }).then(readJson),
      fetch('/api/financial/bank-accounts', { method: 'GET' }).then(readJson),
    ]);

    state.contracts = Array.isArray(contractsR.contracts) ? contractsR.contracts : [];
    state.insurances = Array.isArray(insR.insurances) ? insR.insurances : [];
    state.deadlines = Array.isArray(deadR.deadlines) ? deadR.deadlines : [];
    state.credits = Array.isArray(credR.credits) ? credR.credits : [];
    state.bankAccounts = Array.isArray(bankR.accounts) ? bankR.accounts : [];

    byId('fin-kpi-abos').textContent = eur(statusR.monthly_subscription_cost);
    byId('fin-kpi-abos-count').textContent = `${statusR.active_subscriptions ?? 0} aktive Abos`;
    byId('fin-kpi-contracts').textContent = String(state.contracts.length);
    byId('fin-kpi-insurances').textContent = eur(insR.yearly_cost);
    byId('fin-kpi-insurances-count').textContent = `${state.insurances.length} Policen`;
    byId('fin-kpi-deadlines').textContent = String(state.deadlines.length);
    byId('fin-kpi-emails').textContent = `${statusR.steuer_relevant ?? 0} steuerrel. E-Mails`;

    const dup = Number(summaryR.duplicate_subscription_rows || 0);
    const notice = byId('fin-dup-notice');
    if (notice) {
      notice.hidden = dup <= 0;
      notice.textContent = dup > 0
        ? `Datenhinweis (${summaryR.data_source || 'measured'}): ${dup} doppelte Abo-Zeilen in der Datenbank erkannt — Monatsbetrag beruht auf bereinigter Summierung.`
        : '';
    }

    renderPanels();
    setStatus(`Gemessener Finanzstand geladen (${state.contracts.length} Verträge, ${state.insurances.length} Versicherungen, ${state.deadlines.length} Fristen).`);
  } catch (err) {
    renderPanels();
    setStatus(`Finanzdaten nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

document.querySelectorAll('.fin-tab').forEach((btn) => {
  btn.addEventListener('click', () => selectTab(btn.dataset.finTab || 'contracts'));
});
byId('fin-search')?.addEventListener('input', () => renderPanels());
byId('fin-refresh')?.addEventListener('click', () => loadAll());

selectTab('contracts');
loadAll();
