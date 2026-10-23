import {agentChoices, loadModelCatalogue, loadSocketSnapshot, saveSocketChange} from './model-sockets.mjs';

export function mountModelSockets(root, {document = globalThis.document, fetcher = globalThis.fetch,
  window = globalThis.window} = {}) {
  const find = name => root.querySelector('[data-sockets-' + name + ']');
  const status = find('status'), targets = find('targets'), catalogueStatus = find('catalogue-status');
  const dialog = find('dialog'), fields = find('fields'), form = find('form'), feedback = find('feedback');
  const submit = find('save'), add = find('add');
  const viewButtons = [find('view-models'), find('view-agents')].filter(Boolean);
  let snapshot = null, catalogue = null, epoch = 0, writing = false, draft = null, inflight = null, view = 'models';
  const node = (tag, text, className) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = String(text);
    if (className) n.className = className;
    return n;
  };
  const button = (label, run, disabled = false) => {
    const n = node('button', label, 'btn btn-sm'); n.type = 'button'; n.disabled = disabled;
    n.addEventListener('click', run); return n;
  };
  const field = (label, name, type, value) => {
    const wrapper = node('label', label), input = node('input');
    input.name = name; input.type = type;
    if (type === 'checkbox') { input.checked = value === true; wrapper.className = 'model-check'; }
    else input.value = value ?? '';
    wrapper.append(input); fields.append(wrapper); return input;
  };
  const select = (label, name, choices, selected) => {
    const wrapper = node('label', label), input = node('select'); input.name = name;
    for (const [value, title] of choices) { const option = node('option', title); option.value = value; input.append(option); }
    input.value = selected ?? choices[0]?.[0] ?? ''; wrapper.append(input); fields.append(wrapper); return input;
  };
  const editable = () => snapshot && !snapshot.migration_required && !writing;
  const catalogueFresh = () => catalogue && snapshot && catalogue.host_id === snapshot.host_id &&
    Math.abs(Date.now() - Date.parse(catalogue.observed_at)) <= 300000;
  const modelsForAddition = () => catalogue?.models.filter(m => m.chat_eligible &&
    !snapshot?.sockets.some(s => s.id === m.socket_id)) || [];
  const nameFor = slot => String(slot.name || slot.agent_id);

  function appendBinding(container, socket, slot) {
    const row = node('div', undefined, 'model-slot'); row.dataset.bindingId = slot.id;
    row.append(node('strong', nameFor(slot)), node('small', slot.agent_id),
      node('p', slot.orphaned ? 'Agentenprofil fehlt · gespeicherte Zuordnung' :
        (slot.enabled ? 'Zuordnung freigegeben' : 'Zuordnung gesperrt') + ' · ' +
        (slot.priority === 'foreground' ? 'Vordergrund' : 'Hintergrund')),
      node('p', 'Kontextvorgabe: ' + (slot.context_tokens === null ? 'keine Vorgabe' : slot.context_tokens + ' Tokens') + ' · Lauf, KV-Belegung und Ressourcenanteil: nicht geprüft.', 'model-note'));
    const slotActions = node('div', undefined, 'model-actions');
    slotActions.append(button('Zugriff bearbeiten', () => openBinding(socket, slot), !editable() || slot.orphaned),
      button('Zuordnung entfernen', () => removeBinding(slot), !editable()));
    row.append(slotActions); container.append(row);

  }

  function renderAgentAccess() {
    const agents = new Map(snapshot.unbound_agent_ids.map(id => [id, {id, name:id, bindings:[]}]));
    for (const socket of snapshot.sockets) for (const slot of socket.slots) {
      if (!agents.has(slot.agent_id)) agents.set(slot.agent_id, {id:slot.agent_id, name:nameFor(slot), bindings:[]});
      agents.get(slot.agent_id).bindings.push({socket, slot});
    }
    if (!agents.size) targets.append(node('p', 'Die Quelle meldet keine Agentenprofile oder gespeicherten Zuordnungen.'));
    for (const agent of [...agents.values()].sort((a,b) => a.name.localeCompare(b.name, 'de'))) {
      const card = node('article', undefined, 'model-socket'); card.dataset.accessAgentId = agent.id;
      card.append(node('h3', agent.name), node('small', agent.id),
        node('p', agent.bindings.length + ' gespeicherte lokale Modellzuordnung(en).', 'model-note'));
      if (!agent.bindings.length) card.append(node('p',
        'Keine lokale Zuordnung gespeichert. Ein externes Ziel, ein Fallback oder ein laufender Zugriff ist hier nicht bestätigt.', 'model-note'));
      for (const {socket, slot} of agent.bindings) {
        const group = node('section');
        group.append(node('h4', socket.model + ' · ' + socket.backend),
          node('small', socket.host_id + ' · ' + (socket.enabled ? 'Modellangebot aktiviert' : 'Modellangebot deaktiviert')),
          node('p', 'Residenz und Ressourcenadmission: nicht bestätigt. Diese Zuordnung reserviert keinen eigenen Hardwareplatz.', 'model-note'));
        appendBinding(group, socket, slot); card.append(group);
      }
      targets.append(card);
    }
  }

  function render() {
    targets.replaceChildren();
    submit.disabled = writing || !!draft && !editable();
    add.disabled = !editable() || !catalogueFresh() || !modelsForAddition().length;
    const provenance = find('provenance');
    if (provenance) provenance.textContent = snapshot
      ? 'Konfigurationsquelle: ' + (snapshot.migration_required ? 'Legacy-Vorschau' : 'kanonische Modellkonfiguration') +
        ' · Host: ' + snapshot.host_id + ' · Version: ' + snapshot.configuration_version +
        ' · Host-Anfragegrenze: ' + snapshot.host_inference_limit +
        ' · Residenz, RAM-Reserve und tatsächliche Parallelität: nicht bestätigt.'
      : 'Konfigurationsquelle und aktuelle Ressourcennutzung nicht verfügbar.';
    for (const toggle of viewButtons)
      toggle.setAttribute('aria-pressed', String(toggle.dataset.socketsView === view));
    if (!snapshot) return;
    status.textContent = snapshot.migration_required
      ? 'Zuordnungen noch nicht übernommen · bestehende Profile werden als Vorschau angezeigt. Modelländerungen sind erst nach der Einrichtung möglich.'
      : 'Gespeicherte Modellzuordnungen · ' + snapshot.sockets.length + ' lokale Modellangebote. Das bestätigt weder Residenz noch einen laufenden Agenten.';
    if (view === 'agents') { renderAgentAccess(); return; }
    if (!snapshot.sockets.length) targets.append(node('p', 'Noch kein lokales Modell zugeordnet. Wähle ein bestätigtes Chatmodell aus dem Katalog.'));
    for (const socket of snapshot.sockets) {
      const card = node('article', undefined, 'model-socket'); card.dataset.socketId = socket.id;
      const title = node('div', undefined, 'model-socket-heading');
      title.append(node('h3', socket.model), node('span', socket.enabled ? 'Angebot aktiviert' : 'Angebot deaktiviert', 'badge'));
      card.append(title, node('p', (socket.backend === 'ollama' ? 'Ollama' : 'LM Studio') + ' · ' + socket.host_id));
      const metadata = catalogue?.models.find(m => m.socket_id === socket.id);
      card.append(node('p', metadata ? (metadata.chat_eligible ? 'Chatfähig' : 'Nur Embedding / kein Chat') +
        (metadata.native_tools_capable ? ' · native Tools' : ' · keine native Toolfähigkeit gemeldet')
        : 'Modellangebot und Fähigkeiten derzeit nicht bestätigt.', 'model-note'));
      card.append(node('p', 'Residenz, Gewichts-/KV-Belegung und RAM-Anteil: nicht gemessen. Konfigurierte Anfragegrenze: ' +
        socket.effective_max_active_slots + ' · geplant: ' + socket.max_active_slots + ' · Kapazitätsnachweis: ' + (socket.capacity_verified ? 'von der Quelle gemeldet' : 'nicht bestätigt'), 'model-note'));
      const actions = node('div', undefined, 'model-actions');
      actions.append(button('Modell bearbeiten', () => openSocket(socket), !editable()),
        button('Agent zuordnen', () => openBinding(socket), !editable() || !agentChoices(snapshot).length));
      card.append(actions);
      const slots = node('details', undefined, 'model-slot-list');
      slots.append(node('summary', 'Agentenzugriffe (' + socket.slots.length + ')'));
      if (!socket.slots.length) slots.append(node('p', 'Diesem Modell ist noch kein Agent zugeordnet.'));
      for (const slot of socket.slots) appendBinding(slots, socket, slot);
      card.append(slots); targets.append(card);
    }
  }

  function openSocket(socket) {
    if (!editable()) return;
    if (!socket && (!catalogueFresh() || !modelsForAddition().length)) return;
    draft = {kind:'socket', snapshot:structuredClone(snapshot), socket}; fields.replaceChildren(); feedback.textContent = '';
    find('title').textContent = socket ? 'Modellangebot bearbeiten' : 'Lokales Modell zuordnen';
    if (socket) fields.append(node('p', socket.model + ' · ' + socket.backend));
    else select('Bestätigtes Chatmodell', 'model-choice', modelsForAddition().map(m => [m.socket_id, m.model + ' · ' + m.backend]));
    field('Modell für zugeordnete Agenten freigeben', 'enabled', 'checkbox', socket?.enabled ?? true);
    const count = field('Geplante parallele Modellanfragen', 'max-active', 'number', socket?.max_active_slots ?? 1);
    count.min = '1'; count.max = '1000'; count.step = '1'; count.required = true;
    select('Geplante Residenzregel', 'residency', [['exclusive','Exklusiv'],['shared','Gemeinsam']], socket?.residency_policy);
    fields.append(node('p', 'Die geplante Parallelität ist keine Kapazitätsfreigabe. Die Übersicht nennt konfigurierte Grenzen; eine aktuelle Ressourcenadmission ist hier nicht bestätigt. Speichern lädt kein Modell und startet keinen Agenten.', 'model-note'));
    submit.disabled = false; dialog.showModal();
  }

  function openBinding(socket, slot) {
    if (!editable()) return;
    draft = {kind:'bind', snapshot:structuredClone(snapshot), socket, slot}; fields.replaceChildren(); feedback.textContent = '';
    find('title').textContent = slot ? 'Agentenzugriff bearbeiten' : 'Agent einem Modell zuordnen';
    fields.append(node('p', socket.model));
    const agent = select('Agentenprofil', 'agent', agentChoices(snapshot).map(a => [a.id, a.name]), slot?.agent_id);
    agent.disabled = !!slot;
    field('Zuordnung freigeben', 'enabled', 'checkbox', slot?.enabled ?? true);
    select('Vorrang', 'priority', [['foreground','Vordergrund'],['background','Hintergrund']], slot?.priority ?? 'background');
    const context = field('Geplantes Kontextlimit (leer = keine Vorgabe)', 'context', 'number', slot?.context_tokens);
    context.min = '1'; context.max = '1048576'; context.step = '1';
    fields.append(node('p', 'Diese Zuordnung ändert weder das Hauptmodell noch die Fallbackkette des Profils. Sie reserviert keine Ressourcen und startet keinen Agenten. Kontextbudgets müssen vom Laufzeitdienst umgesetzt werden.', 'model-note'));
    submit.disabled = false; dialog.showModal();
  }

  async function write(operation, loadedSnapshot) {
    if (writing) return;
    if (!editable()) {
      feedback.textContent = 'Die Modellzuordnung ist derzeit nicht zur Bearbeitung verfügbar. Dein Entwurf bleibt erhalten.';
      return;
    }
    let message = '';
    writing = true; epoch += 1; submit.disabled = true; render();
    try {
      const observed = await saveSocketChange(loadedSnapshot, operation, fetcher);
      snapshot = observed; render();
      if (dialog.open) dialog.close(); draft = null;
      message = 'Zuordnung gespeichert und rückgelesen. Kein Agent wurde gestartet.';
      window.dispatchEvent(new window.CustomEvent('bach:model-sockets-changed', {detail:{configuration_version:observed.configuration_version}}));
    } catch (error) {
      message = error instanceof Error ? error.message : 'Die Speicherung konnte nicht bestätigt werden.';
      feedback.textContent = message;
      // A failed write is never retried or converted into a new-version write.
    } finally { writing = false; submit.disabled = false; render(); status.textContent = message; }
  }

  async function removeBinding(slot) {
    if (!editable() || !window.confirm('Zuordnung von ' + nameFor(slot) + ' entfernen? Das Agentenprofil bleibt erhalten.')) return;
    await write({kind:'unbind', binding_id:slot.id}, structuredClone(snapshot));
  }

  form.addEventListener('submit', event => {
    event.preventDefault(); if (!draft || writing) return;
    if (!editable()) {
      feedback.textContent = 'Die Modellzuordnung ist derzeit nicht zur Bearbeitung verfügbar. Dein Entwurf bleibt erhalten.';
      return;
    }
    if (!form.reportValidity()) return;
    const input = name => fields.querySelector('[name="' + name + '"]');
    if (draft.kind === 'socket') {
      const target = draft.socket || catalogue?.models.find(m => m.socket_id === input('model-choice').value);
      if (!target || !draft.socket && !catalogueFresh()) { feedback.textContent = 'Bitte den Modellkatalog neu prüfen.'; return; }
      void write({kind:'socket', changes:{backend:target.backend, model:target.model, enabled:input('enabled').checked,
        max_active_slots:Number(input('max-active').value), residency_policy:input('residency').value}}, draft.snapshot);
    } else {
      const context = input('context').value.trim();
      void write({kind:'bind', socket_id:draft.socket.id, agent_id:input('agent').value,
        changes:{enabled:input('enabled').checked, priority:input('priority').value,
          context_tokens:context ? Number(context) : null}}, draft.snapshot);
    }
  });
  find('close').addEventListener('click', () => { if (!writing) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (writing) event.preventDefault(); });
  dialog.addEventListener('close', () => { draft = null; });
  add.addEventListener('click', () => openSocket());

  function refresh() {
    if (writing) return Promise.resolve();
    if (inflight) return inflight;
    const generation = ++epoch;
    inflight = (async () => {
      try {
        const loaded = await loadSocketSnapshot(fetcher);
        if (generation !== epoch) return;
        snapshot = loaded;
        catalogue = null;
        catalogueStatus.textContent = 'Modellkatalog wird neu geprüft.';
        render();
        if (draft && draft.snapshot.configuration_version !== loaded.configuration_version)
          feedback.textContent = 'Die Konfiguration wurde geändert. Dein Entwurf bleibt sichtbar; bitte vor dem Speichern neu prüfen.';
        try {
          const loadedCatalogue = await loadModelCatalogue(loaded.host_id, fetcher);
          if (generation !== epoch) return;
          catalogue = loadedCatalogue;
          const count = catalogue.models.filter(m => m.chat_eligible).length;
          catalogueStatus.textContent = count + ' bestätigte Chatmodelle · Katalog ' +
            new Date(catalogue.observed_at).toLocaleTimeString('de-DE') + '. ' +
            catalogue.providers.filter(p => p.status !== 'verified').map(p =>
              (p.backend === 'lmstudio' ? 'LM Studio' : 'Ollama') + ': Fähigkeiten nicht geprüft.').join(' ');
        } catch (_error) {
          if (generation !== epoch) return;
          catalogue = null; catalogueStatus.textContent = 'Modellkatalog nicht verfügbar; gespeicherte Zuordnungen bleiben sichtbar.';
        }
        render();
      } catch (error) {
        if (generation !== epoch) return;
        snapshot = null; catalogue = null; render();
        status.textContent = error instanceof Error ? error.message : 'Modellzuordnung nicht verfügbar.';
        catalogueStatus.textContent = 'Kein bestätigter Modellkatalog.';
      } finally { inflight = null; }
    })();
    return inflight;
  }
  for (const toggle of viewButtons) toggle.addEventListener('click', () => {
    const next = toggle.dataset.socketsView;
    if (!['models', 'agents'].includes(next) || writing) return;
    view = next; render();
  });
  find('refresh').addEventListener('click', () => void refresh());
  window.addEventListener('bach:core-config-observed', event => {
    if (!snapshot || event.detail?.configuration_version === snapshot.configuration_version || writing) return;
    void refresh();
  });
  void refresh();
  return {refresh};
}
