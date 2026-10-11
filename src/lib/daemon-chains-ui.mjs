// Browser wiring for /daemon?tab=chains (P-1963-P4). DOM via createElement/textContent only; no inline handlers.
import {createChainClient, createLatest, listState, stepSummary, isParallel, rowsFromSteps, saveChain, pollForNewRun, maxRunId, durationText, TRIGGER_TYPES} from './daemon-chains.mjs';

const root = document.getElementById('daemon-chains');
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined && text !== null) n.textContent = text; return n; };
const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
const part = id => root.querySelector('[data-part="' + id + '"]');
const client = createChainClient();
const latest = createLatest();
const state = {loading: false, error: null, chains: [], editing: null, openRuns: new Set()};
const MAX_LOG = 4000;

function status(message, isError) { const n = part('status'); n.textContent = message || ''; n.className = isError ? 'dc-problem' : 'dc-muted'; }
const button = (label, handler, className) => { const b = el('button', 'btn' + (className ? ' ' + className : ''), label); b.type = 'button'; b.addEventListener('click', handler); return b; };
const when = value => { if (!value) return 'unbekannt'; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString('de-DE'); };

function renderRuns(box, runs) {
  clear(box);
  if (!runs.length) { box.append(el('p', 'dc-muted', 'Noch keine Ausführungen.')); return; }
  for (const r of runs) {
    const row = el('div', 'dc-run');
    row.append(el('strong', null, r.status), ' ', el('span', 'dc-muted', [when(r.startedAt), durationText(r.duration),
      (r.stepsCompleted ?? '?') + '/' + (r.stepsTotal ?? '?') + ' Schritte', r.triggeredBy].join(' · ')));
    if (r.error) row.append(el('p', 'dc-problem', r.error));
    if (r.log) {
      const details = el('details'); details.append(el('summary', null, 'Protokoll'));
      details.append(el('pre', null, r.log.length > MAX_LOG ? r.log.slice(0, MAX_LOG) + '\n… (gekürzt, ' + r.log.length + ' Zeichen)' : r.log));
      row.append(details);
    }
    box.append(row);
  }
}

async function loadRuns(chain, box) {
  clear(box).append(el('p', 'dc-muted', 'Verlauf wird geladen …'));
  try { renderRuns(box, await client.runs(chain.id, 10)); }
  catch (error) { clear(box).append(el('p', 'dc-problem', 'Verlauf nicht verfügbar: ' + error.message)); }
}

// A run is recorded when it FINISHES: poll the history (every 3 s, at most 20 times) until a run newer than the known ones appears.
async function awaitNewRun(chain, box, knownMaxId) {
  try {
    const result = await pollForNewRun(() => client.runs(chain.id, 10), knownMaxId, {active: () => box.isConnected && !box.hidden});
    if (result.status === 'found') { renderRuns(box, result.runs); status('Lauf abgeschlossen: ' + result.runs.find(r => r.id > knownMaxId).status); load(); }
    else if (result.status === 'none') status('Noch kein abgeschlossener Lauf im Verlauf; mit "Verlauf" später erneut prüfen.');
  } catch (error) { status('Verlauf nicht verfügbar: ' + error.message, true); }
}

function chainCard(chain) {
  const card = el('article', 'dc-card');
  const head = el('div', 'dc-card-head');
  const title = el('div'); title.append(el('h3', null, chain.name));
  if (chain.description) title.append(el('p', 'dc-muted', chain.description));
  head.append(title, el('span', 'dc-badge' + (chain.active ? '' : ' dc-off'), chain.active ? 'Aktiv' : 'Inaktiv'));
  card.append(head);
  if (chain.stepsError) card.append(el('p', 'dc-problem', 'Schritte nicht lesbar: ' + chain.stepsError + '. Beim Bearbeiten bleibt der gespeicherte Rohwert unverändert, außer die Schritte werden ausdrücklich ersetzt.'));
  else if (!chain.steps.length) card.append(el('p', 'dc-muted', 'Keine Schritte definiert.'));
  else { const ol = el('ol', 'dc-steps'); for (const s of chain.steps) ol.append(el('li', isParallel(s) ? 'dc-parallel' : null, stepSummary(s))); card.append(ol); }
  card.append(el('p', 'dc-muted', 'Trigger: ' + chain.triggerType + (chain.triggerValue ? ' (' + chain.triggerValue + ')' : '') + ' · Letzter Lauf: ' + (chain.lastRun ? when(chain.lastRun) : 'noch nie') + ' · ' + chain.steps.length + ' Schritt(e)'));
  const runsBox = el('div', 'dc-runs'); runsBox.hidden = !state.openRuns.has(chain.id);
  const actions = el('div', 'dc-actions');
  actions.append(
    button('Ausführen', async () => {
      if (!confirm('Kette "' + chain.name + '" jetzt ausführen?')) return;
      try {
        const before = maxRunId(await client.runs(chain.id, 10));
        await client.run(chain.id); status('Kette gestartet. Das Ergebnis erscheint im Verlauf.'); state.openRuns.add(chain.id); runsBox.hidden = false;
        awaitNewRun(chain, runsBox, before);
      }
      catch (error) { status('Start fehlgeschlagen: ' + error.message, true); }
    }, 'btn-primary'),
    button(chain.active ? 'Deaktivieren' : 'Aktivieren', async () => {
      try { await client.toggle(chain.id); load(); } catch (error) { status('Umschalten fehlgeschlagen: ' + error.message, true); }
    }),
    button('Bearbeiten', () => startEdit(chain)),
    button('Verlauf', () => { if (runsBox.hidden) { state.openRuns.add(chain.id); runsBox.hidden = false; loadRuns(chain, runsBox); } else { state.openRuns.delete(chain.id); runsBox.hidden = true; } }),
    Object.assign(button('Löschen', async () => {
      if (!confirm('Kette "' + chain.name + '" wirklich löschen? (inkl. Verlauf)')) return;
      try { await client.remove(chain.id); status('Gelöscht.'); load(); } catch (error) { status('Löschen fehlgeschlagen: ' + error.message, true); }
    }), {className: 'btn dc-danger'}),
  );
  card.append(actions, runsBox);
  if (state.openRuns.has(chain.id)) loadRuns(chain, runsBox);
  return card;
}

function renderList() {
  const list = clear(part('list'));
  const kind = listState({loading: state.loading, error: state.error, chains: state.chains});
  if (kind === 'loading') { list.append(el('p', 'dc-muted', 'Ketten werden geladen …')); return; }
  if (kind.startsWith('error:')) {
    const box = el('div', 'dc-problem'); box.append(el('strong', null, 'Ketten nicht verfügbar: '), state.error.message);
    list.append(box, el('p', 'dc-muted', 'Das ist ein Fehler, kein leerer Bestand.')); return;
  }
  if (kind === 'empty') { list.append(el('p', 'dc-muted', 'Keine Toolchains definiert. Mit "Neue Kette" anlegen.')); return; }
  for (const chain of state.chains) list.append(chainCard(chain));
}

async function load() {
  const token = latest.next();
  state.loading = state.chains.length === 0; state.error = null; renderList();   // keep the visible list while refreshing
  try {
    const chains = await client.list();
    if (!latest.isCurrent(token)) return;
    state.chains = chains; state.loading = false; part('count').textContent = chains.length + ' Ketten';
  } catch (error) {
    if (!latest.isCurrent(token)) return;
    state.loading = false; state.error = error; state.chains = []; part('count').textContent = 'Unbekannt';
  }
  renderList();
}

// ---------------------------------------------------------------- editor
function stepRow(row, container) {
  const wrap = el('div', 'dc-step-row'); wrap.dataset.parallel = row.parallel ? '1' : '0';
  if (row.parallel) {
    wrap.append(el('span', 'dc-parallel', stepSummary(row.original) + ' (bleibt unverändert erhalten)'));
  } else {
    const tool = el('input'); tool.type = 'text'; tool.className = 'dc-tool'; tool.value = row.tool; tool.placeholder = 'Tool, z. B. scan'; tool.setAttribute('aria-label', 'Tool');
    const args = el('input'); args.type = 'text'; args.className = 'dc-args'; args.value = row.args; args.placeholder = 'Argumente als JSON-Array, z. B. ["run", "hello world"]'; args.setAttribute('aria-label', 'Argumente (JSON-Array, ein Eintrag je Argument)');
    wrap.append(tool, args);
  }
  wrap.append(button('Entfernen', () => { if (container.children.length > 1) wrap.remove(); }));
  wrap._row = row;
  return wrap;
}

function readRows(container) {
  return [...container.children].map(wrap => wrap._row.parallel ? wrap._row
    : {original: wrap._row.original, tool: wrap.querySelector('.dc-tool').value, args: wrap.querySelector('.dc-args').value});
}

function startEdit(chain) {
  state.editing = chain ? chain.id : null;
  const box = clear(part('editor')); box.hidden = false;
  box.append(el('h2', null, chain ? 'Kette bearbeiten' : 'Neue Kette'));
  const field = (labelText, control) => { const l = el('label'); l.append(el('span', null, labelText), control); return l; };
  const text = value => { const i = el('input'); i.type = 'text'; i.value = value || ''; return i; };
  const name = text(chain && chain.name), description = text(chain && chain.description), value = text(chain && chain.triggerValue);
  const type = el('select'); for (const t of TRIGGER_TYPES) type.append(Object.assign(el('option', null, t.label), {value: t.value}));
  type.value = chain ? chain.triggerType : 'manual';
  if (type.value !== (chain ? chain.triggerType : 'manual')) { type.append(Object.assign(el('option', null, chain.triggerType), {value: chain.triggerType})); type.value = chain.triggerType; }
  const steps = el('div', 'dc-steps-editor');
  const blank = () => ({original: null, parallel: false, tool: '', args: '[]'});
  const initial = chain && !chain.stepsError && chain.steps.length ? rowsFromSteps(chain.steps) : [blank()];
  for (const row of initial) steps.append(stepRow(row, steps));
  // Unreadable steps_json: the raw value is kept on save (steps not sent). Replacing it is a separate, confirmed step.
  const broken = !!(chain && chain.stepsError);
  let replacing = !broken;
  const addStep = button('+ Schritt', () => steps.append(stepRow(blank(), steps)));
  box.append(field('Name', name), field('Beschreibung', description), field('Trigger-Typ', type), field('Trigger-Wert (z. B. 02:00 oder task_completed)', value));
  box.append(el('h3', null, 'Schritte (Befehle)'));
  if (broken) {
    steps.hidden = true; addStep.hidden = true;
    const note = el('p', 'dc-problem', 'Die gespeicherten Schritte sind nicht lesbar (' + chain.stepsError + '). Beim Speichern bleiben sie unverändert.');
    const replace = button('Schritte ersetzen …', () => {
      if (!confirm('Die gespeicherten (unlesbaren) Schritte durch neu eingegebene ersetzen? Der alte Rohwert geht dabei verloren.')) return;
      replacing = true; steps.hidden = false; addStep.hidden = false; note.textContent = 'Die unlesbaren Schritte werden beim Speichern durch die folgenden ersetzt.'; replace.hidden = true;
      const firstTool = steps.querySelector('.dc-tool'); if (firstTool) firstTool.focus();
    });
    box.append(note, replace);
  }
  box.append(steps, addStep);
  const editorError = el('p', 'dc-problem'); editorError.setAttribute('role', 'alert'); editorError.hidden = true;
  box.append(editorError);
  const actions = el('div', 'dc-actions');
  actions.append(
    button('Speichern', async () => {
      const fields = {name: name.value, description: description.value, triggerType: type.value, triggerValue: value.value};
      const result = await saveChain(client, chain, fields, readRows(steps), replacing);
      editorError.textContent = result.ok ? '' : result.message; editorError.hidden = result.ok;
      status(result.message, !result.ok);
      if (result.ok) { box.hidden = true; clear(box); state.editing = null; load(); } else editorError.scrollIntoView({block: 'nearest'});
    }, 'btn-primary'),
    button('Abbrechen', () => { box.hidden = true; clear(box); state.editing = null; }),
  );
  box.append(actions);
  name.focus();
}

if (root) {
  part('new').addEventListener('click', () => startEdit(null));
  part('refresh').addEventListener('click', load);
  load();
}
