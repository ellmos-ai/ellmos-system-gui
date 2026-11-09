import {createTriggerClient} from './agent-triggers.mjs';

export function formatTriggerStatus(count) {
  if (count === 0) return 'Noch keine Startregel gespeichert.';
  if (count === 1) return '1 Startregel gespeichert.';
  return `${count} Startregeln gespeichert.`;
}

export function mountAgentTriggers(panel, client = createTriggerClient()) {
  const find = name => panel.querySelector(`[data-trigger-${name}]`);
  const form = find('form'), status = find('status'), list = find('list');
  const field = name => form.elements.namedItem(name);
  let snapshot = null, available = false, busy = false, epoch = 0;
  const message = text => { status.textContent = text; };
  function setBusy(value) {
    busy = value;
    panel.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = value; });
    find('new').disabled = value || !available;
  }
  function edit(value) {
    if (busy || !available) return;
    snapshot = value ? structuredClone(value) : null;
    form.reset();
    field('id').value = value?.id || '';
    field('id').readOnly = !!value;
    for (const name of ['agent_id', 'executor']) field(name).value = value?.[name] || '';
    field('kind').value = value?.schedule.kind || 'once';
    field('schedule').value = JSON.stringify(value?.schedule || {kind: 'once', at: ''}, null, 2);
    field('payload').value = JSON.stringify(value?.payload || {}, null, 2);
    field('authorities').value = JSON.stringify(value?.authorities || [], null, 2);
    field('enabled').checked = value?.enabled || false;
    form.hidden = false;
  }
  async function refresh() {
    const own = ++epoch;
    try {
      const values = await client.list();
      if (own !== epoch) return;
      available = true; list.replaceChildren();
      for (const value of values.filter(v => !v.deleted)) {
        const row = document.createElement('article');
        const text = document.createElement('p');
        text.textContent = `${value.id} · Agent ${value.agent_id} · ${value.schedule.kind} · ${value.enabled ? 'Aktiviert' : 'Deaktiviert'} · Version ${value.version}`;
        row.append(text);
        for (const [label, action] of [['Bearbeiten', () => edit(value)], ['Löschen', async () => {
          if (!available || busy) return;
          setBusy(true);
          try { await client.remove(value); await refresh(); message('Definition gelöscht. Laufhistorie bleibt erhalten.'); }
          catch (error) { message(error.message); }
          finally { setBusy(false); }
        }]]) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm'; button.textContent = label;
          button.addEventListener('click', action); row.append(button);
        }
        list.append(row);
      }
      message(formatTriggerStatus(values.filter(v => !v.deleted).length));
    } catch (error) { if (own !== epoch) return; available = false; list.replaceChildren(); message(error.message); }
    find('new').disabled = !available;
  }
  find('new').addEventListener('click', () => { if (available && !busy) edit(null); });
  find('refresh').addEventListener('click', refresh);
  find('cancel').addEventListener('click', () => { if (!busy) { form.hidden = true; snapshot = null; } });
  field('kind').addEventListener('change', () => {
    const examples = {once: {kind: 'once', at: ''}, daily: {kind: 'daily', time: '09:00', timezone: 'Europe/Berlin'}, interval: {kind: 'interval', seconds: 3600}, cron: {kind: 'cron', expression: '0 9 * * 1', timezone: 'Europe/Berlin'}, event: {kind: 'event', event_type: 'task.accepted'}};
    field('schedule').value = JSON.stringify(examples[field('kind').value], null, 2);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!available || busy) return;
    setBusy(true);
    try {
      const changes = {agent_id: field('agent_id').value.trim(), executor: field('executor').value.trim(), schedule: JSON.parse(field('schedule').value), payload: JSON.parse(field('payload').value), authorities: JSON.parse(field('authorities').value), enabled: field('enabled').checked};
      if (changes.schedule.kind !== field('kind').value) throw new Error('Auslöser und Zeitplan stimmen nicht überein.');
      if (snapshot) await client.update(snapshot, changes);
      else await client.create({id: field('id').value.trim(), ...changes});
      form.hidden = true; snapshot = null; await refresh(); message('Definition unabhängig bestätigt. Kein Worker gestartet.');
    } catch (error) { message(error.message); }
    finally { setBusy(false); }
  });
  refresh();
  return {refresh};
}
