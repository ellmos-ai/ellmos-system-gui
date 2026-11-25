// Client-Logik für /steuer — liest /api/steuer/dokumente/unlinked und /api/financial/* via DOM-Textknoten
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
  const node = byId('st-status');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  return body;
}

async function loadSteuer() {
  setStatus('Lade Steuer- und Belegdaten …');
  try {
    const [docsR, finStatusR, finSummaryR, insR] = await Promise.all([
      fetch('/api/steuer/dokumente/unlinked', { method: 'GET' }).then(readJson),
      fetch('/api/financial/status', { method: 'GET' }).then(readJson),
      fetch('/api/financial/summary', { method: 'GET' }).then(readJson),
      fetch('/api/financial/insurances', { method: 'GET' }).then(readJson),
    ]);

    const docs = Array.isArray(docsR.docs) ? docsR.docs : [];
    const insurances = (Array.isArray(insR.insurances) ? insR.insurances : []).filter((i) => Boolean(i.steuer_relevant_typ));
    const latestSummary = Array.isArray(finSummaryR.summaries) && finSummaryR.summaries.length ? finSummaryR.summaries[0] : null;

    byId('st-kpi-emails').textContent = String(finStatusR.steuer_relevant ?? 0);
    byId('st-kpi-total-emails').textContent = `von ${finStatusR.total_emails ?? 0} gescannten E-Mails`;
    byId('st-kpi-unlinked').textContent = String(docs.length);
    byId('st-kpi-ins').textContent = String(insurances.length);
    byId('st-kpi-sum').textContent = latestSummary ? eur(latestSummary.total_steuer_relevant) : '–';

    const insList = byId('st-ins-list');
    if (insList) {
      insList.replaceChildren();
      if (!insurances.length) {
        insList.append(el('p', 'st-meta', 'Keine als steuerrelevant markierten Versicherungen vorhanden.'));
      } else {
        for (const i of insurances) {
          const card = el('article', 'st-item');
          const head = el('div', 'st-item-head');
          head.append(el('strong', '', i.tarif_name || i.sparte || 'Versicherung'));
          head.append(el('span', 'badge', i.steuer_relevant_typ));
          card.append(head);
          card.append(el('p', 'st-meta', [i.anbieter, i.police_nr ? `Police ${i.police_nr}` : '', i.beitrag != null ? `${eur(i.beitrag)} (${i.zahlweise || 'Beitrag'})` : ''].filter(Boolean).join(' · ')));
          insList.append(card);
        }
      }
    }

    const docsList = byId('st-docs-list');
    if (docsList) {
      docsList.replaceChildren();
      if (!docs.length) {
        docsList.append(el('p', 'st-meta', 'Aktuell keine unverknüpften Steuerbelege gemeldet.'));
      } else {
        for (const d of docs) {
          const card = el('article', 'st-item');
          card.append(el('strong', '', d.filename || d.title || `Beleg #${d.id ?? '?'}`));
          card.append(el('p', 'st-meta', [d.datum, d.betrag != null ? eur(d.betrag) : '', d.kategorie].filter(Boolean).join(' · ') || 'Ohne Metadaten'));
          docsList.append(card);
        }
      }
    }

    setStatus(`Steuerstand geladen: ${finStatusR.steuer_relevant ?? 0} steuerrelevante E-Mails, ${insurances.length} Vorsorge-Policen, ${docs.length} unverknüpfte Belege.`);
  } catch (err) {
    setStatus(`Steuerdaten nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

byId('st-refresh')?.addEventListener('click', () => loadSteuer());
loadSteuer();
