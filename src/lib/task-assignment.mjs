// Task binding comes exclusively from the versioned consumer catalogue.
export const KEEP_BINDING = '__keep_binding__';
const text = value => typeof value === 'string' ? value.trim() : '';
const blueprintIdentity = value => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : '';
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return '';
  const number = Number(value);
  return Number.isSafeInteger(number) && String(number) === value ? value : '';
};
const bindingKeys = ['assigned_slot', 'assigned_to', 'required_model'];

export function assignmentCatalogue(body) {
  if (!body || body.schema !== 'bach.task-assignees.v1' ||
      body.source !== 'native_control_and_blueprints' || !text(body.configuration_version) ||
      !Array.isArray(body.targets)) throw new Error('Agentenauswahl: Backendvertrag nicht verfügbar.');
  const ids = new Set();
  const targets = body.targets.map(item => {
    if (!item || !['system-slot', 'blueprint'].includes(item.type) || !text(item.id) ||
        !text(item.name) || ids.has(item.id)) throw new Error('Agentenauswahl: Zielkatalog ungültig.');
    ids.add(item.id);
    const binding = Object.fromEntries(bindingKeys.map(key => [key, text(item.binding?.[key])]));
    const identityId = item.type === 'system-slot' ? text(item.slot_id) : blueprintIdentity(item.blueprint_id);
    if (!identityId) throw new Error('Agentenauswahl: Zielkatalog enthält eine ungültige ID.');
    const identity = (item.type === 'system-slot' ? 'slot:' : 'blueprint:') + identityId;
    const validBinding = item.id === identity && binding.assigned_slot === text(item.slot_id) &&
      !!binding.assigned_slot && !!binding.assigned_to && !!binding.required_model &&
      binding.required_model === text(item.model);
    return {...item, binding, assignable:item.assignable === true && item.enabled === true && validBinding};
  });
  return {configuration_version:body.configuration_version, targets};
}

export function assignmentOptions(catalogue, current = {}) {
  const options = [];
  const oldSlot = text(current.assigned_slot);
  if (oldSlot) {
    const target = catalogue?.targets.find(item => item.binding.assigned_slot === oldSlot && item.assignable);
    options.push({value:KEEP_BINDING, label:'Aktuelle Bindung beibehalten · ' + oldSlot +
      (target ? '' : ' · Nicht verfügbar'), disabled:false});
  }
  options.push({value:'', label:oldSlot ? 'Agenten-Slot entfernen · manuell zuweisen' : 'Manuell zuweisen · ohne Agenten-Slot', disabled:!!oldSlot && !catalogue});
  for (const target of catalogue?.targets || []) {
    const state = target.runtime_verified !== true ? 'Live-Status nicht bestätigt' :
      target.running === true ? 'Running' : target.living === true ? 'Living' : 'Keine aktive Instanz bestätigt';
    const reason = target.reason === 'blueprint_requires_instance' ? 'Instanz erforderlich' :
      target.enabled !== true ? 'Deaktiviert' : 'Nicht zuweisbar';
    options.push({value:target.id, label:target.name + ' · ' + (text(target.model) || 'Modell fehlt') +
      ' · ' + (target.assignable ? state : reason), disabled:!target.assignable});
  }
  return options;
}

export function assignmentPayload(catalogue, selected, current = {}) {
  if (selected === KEEP_BINDING && text(current.assigned_slot)) return {};
  if (selected === '') {
    if (!text(current.assigned_slot)) return {};
    if (!catalogue) throw new Error('Zum Entfernen des Slots muss die Agentenauswahl neu geladen werden.');
    return {assigned_slot:'', assignment_configuration_version:catalogue.configuration_version};
  }
  const target = catalogue?.targets.find(item => item.id === selected && item.assignable);
  if (!target) throw new Error('Das gewählte Ziel ist nicht zuweisbar. Agentenauswahl neu laden.');
  return {...target.binding, assignment_configuration_version:catalogue.configuration_version};
}

export function taskResponseError(body, status) {
  const detail = body?.detail;
  const message = typeof detail === 'string' ? detail : typeof detail?.message === 'string' ? detail.message :
    typeof body?.error === 'string' ? body.error : `Aufgabe nicht gespeichert (HTTP ${status}).`;
  return status === 409 ? message + ' Agentenauswahl neu laden und erneut auswählen.' : message;
}

export function createAssignmentController(form, {fixedAssignee = false, fetchImpl = globalThis.fetch} = {}) {
  const select = form.querySelector('[data-task-target]');
  const note = form.querySelector('[data-task-target-status]');
  const reloadButton = form.querySelector('[data-task-target-reload]');
  const assignee = form.elements.assigned_to;
  const model = form.elements.required_model;
  let catalogue = null, current = {}, generation = 0;
  let manual = {assigned_to:assignee.value || 'user', required_model:model.value || ''};
  let invalidated = false;

  function fillFields() {
    const selected = select.value;
    const target = catalogue?.targets.find(item => item.id === selected && item.assignable);
    const preserved = selected === KEEP_BINDING && text(current.assigned_slot);
    const binding = target?.binding || (preserved ? current : manual);
    const name = text(binding.assigned_to) || 'user';
    if (!Array.from(assignee.options).some(option => option.value === name)) {
      const option = form.ownerDocument.createElement('option'); option.value = name;
      option.textContent = name; assignee.append(option);
    }
    assignee.value = name; assignee.disabled = fixedAssignee || !!target || !!preserved;
    model.value = text(binding.required_model); model.readOnly = !!target || !!preserved;
  }

  function populate() {
    select.replaceChildren();
    for (const row of assignmentOptions(catalogue, current)) {
      const option = form.ownerDocument.createElement('option');
      option.value = row.value; option.textContent = row.label; option.disabled = row.disabled; select.append(option);
    }
    select.value = text(current.assigned_slot) ? KEEP_BINDING : '';
    select.disabled = fixedAssignee; fillFields();
  }

  for (const field of [assignee, model]) field.addEventListener('change', () => {
    if (select.value === '') manual = {assigned_to:assignee.value, required_model:model.value};
  });

  select.addEventListener('change', () => {
    fillFields();
    note.textContent = select.value === KEEP_BINDING ? 'Die vorhandene Bindung bleibt unverändert.' :
      select.value ? 'Die Auswahl speichert die Bindung. Sie startet keinen Worker.' : 'Manuelle Zuweisung ohne Agenten-Slot.';
  });
  reloadButton.addEventListener('click', () => { void reload(current); });

  async function reload(task = {}) {
    const previousManual = select.value === '' ? {assigned_to:assignee.value, required_model:model.value} : manual;
    const revision = ++generation; current = {...task}; catalogue = null; invalidated = false;
    manual = {assigned_to:text(task.assigned_to) || previousManual.assigned_to || 'user',
      required_model:Object.hasOwn(task, 'required_model') ? text(task.required_model) : previousManual.required_model || ''};
    populate();
    if (fixedAssignee) { note.textContent = 'Persönliche Aufgabe ohne Agenten-Slot.'; return; }
    select.disabled = true; reloadButton.disabled = true; note.textContent = 'Agentenauswahl wird geladen …';
    try {
      const response = await fetchImpl('/api/task-assignees');
      if (!response.ok) throw new Error('Agentenauswahl nicht erreichbar.');
      const next = assignmentCatalogue(await response.json());
      if (revision !== generation) return;
      catalogue = next; populate();
      note.textContent = text(current.assigned_slot) ? 'Vorhandene Bindung wird beibehalten; ein anderes Ziel muss ausdrücklich ausgewählt werden.' :
        'Nur verfügbare Ziele sind auswählbar. Ein Blueprint benötigt eine vorhandene Instanz.';
    } catch (error) {
      if (revision !== generation) return;
      populate(); note.textContent = 'Agentenauswahl nicht verfügbar. ' +
        (text(current.assigned_slot) ? 'Die vorhandene Bindung bleibt erhalten.' : 'Manuelle Aufgaben bleiben möglich.');
    } finally { if (revision === generation) reloadButton.disabled = false; }
  }

  function payload() {
    if (invalidated && select.value !== KEEP_BINDING && (select.value || text(current.assigned_slot)))
      throw new Error('Agentenauswahl wurde geändert. Neu laden und erneut auswählen.');
    const binding = assignmentPayload(catalogue, select.value, current);
    if (select.value === '') {
      const manualBinding = {assigned_to:assignee.value || 'user', required_model:model.value.trim()};
      for (const [key, value] of Object.entries(manualBinding))
        if (value !== text(current[key])) binding[key] = value;
    }
    return binding;
  }

  function invalidate() {
    catalogue = null; invalidated = true;
    note.textContent = 'Die Konfiguration hat sich geändert. Agentenauswahl neu laden und das Ziel erneut auswählen.';
  }
  return {reload, payload, invalidate};
}
