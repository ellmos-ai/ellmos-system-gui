// A dated selector receipt describes selection, never current inference or authority.
const reasons = {
  task_acquired: 'Task übernommen', empty_queue: 'Kandidatenqueue ist leer',
  selection_excluded: 'Kandidaten durch Auswahl ausgeschlossen',
  acquire_denied: 'Übernahme nicht bestätigt', selection_error: 'Auswahl fehlgeschlagen',
};
const rejections = {
  explicit_slot_required: 'Ausdrückliche Slotzuordnung fehlt', slot_binding: 'Anderer Slot',
  model_binding: 'Anderes Modell', pickup_filter: 'Kategorie, Priorität oder Tags',
  ownership: 'Passende Workerzuweisung fehlt', deferred_version: 'Taskversion bereits zurückgegeben',
  changed_selection: 'Aufgabe zwischenzeitlich geändert', held: 'Lease bereits belegt',
  not_claimable: 'Nicht übernehmbar, zum Beispiel offene Abhängigkeit',
  creator_priority: 'Vorrang des Erstellers', stale_task_version: 'Taskversion veraltet',
  already_held_by_caller: 'Bereits durch diesen Aufrufer belegt', conflict: 'Vergabekonflikt',
};
const denials = new Set(['held','not_claimable','creator_priority','stale_task_version',
  'already_held_by_caller','conflict','changed_selection']);
const stateReasons = {acquired:['task_acquired'], waiting:['empty_queue','selection_excluded','acquire_denied'],
  error:['selection_error']};
const counters = ['candidate_count','matched_count','attempted_count','scanned_pages'];
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const taskId = value => Number.isSafeInteger(value) && value > 0;
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const openStates = new Map();

export function validateQueueStatus(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== 'bach.worker-queue.v1'
      || raw.source !== 'canonical_task_api' || !['local','remote'].includes(raw.authority_mode)
      || typeof raw.state !== 'string' || !own(stateReasons,raw.state) || !stateReasons[raw.state].includes(raw.reason)
      || typeof raw.scan_complete !== 'boolean' || !counters.every(key=>count(raw[key]))) return null;
  if (raw.attempted_count > raw.matched_count || raw.matched_count > raw.candidate_count) return null;
  if (typeof raw.observed_at !== 'string' || raw.observed_at.length > 40
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.observed_at)
      || !Number.isFinite(Date.parse(raw.observed_at))) return null;
  const rejected = raw.rejected_counts;
  if (!rejected || typeof rejected !== 'object' || Array.isArray(rejected)
      || !Object.entries(rejected).every(([key,value])=>own(rejections,key) && count(value))) return null;
  const total = Object.values(rejected).reduce((sum,value)=>sum+value,0);
  if (total > raw.candidate_count) return null;
  for (const key of ['last_candidate_task_id','selected_task_id']) {
    if (raw[key] !== undefined && raw[key] !== null && !taskId(raw[key])) return null;
  }
  if ((raw.state === 'acquired') !== taskId(raw.selected_task_id)) return null;
  if (raw.reason === 'empty_queue' && (raw.candidate_count !== 0 || !raw.scan_complete || raw.scanned_pages !== 1)) return null;
  if (raw.reason === 'selection_excluded' && (raw.candidate_count === 0 || raw.matched_count !== 0 || !raw.scan_complete)) return null;
  if (['task_acquired','acquire_denied'].includes(raw.reason) && raw.attempted_count === 0) return null;
  if (['acquired','error'].includes(raw.state) && raw.scan_complete) return null;
  if (['waiting','acquired'].includes(raw.state)) {
    const acquired = Number(raw.state === 'acquired');
    const attemptsRejected = Object.entries(rejected).reduce((sum,[key,value])=>sum+(denials.has(key)?value:0),0);
    if (total+acquired !== raw.candidate_count || attemptsRejected+acquired !== raw.attempted_count
        || raw.attempted_count !== raw.matched_count) return null;
  }
  const result = Object.fromEntries(['schema','source','authority_mode','state','reason','observed_at',
    'scan_complete',...counters].map(key=>[key,raw[key]]));
  result.rejected_counts = {...rejected};
  for (const key of ['last_candidate_task_id','selected_task_id']) if (taskId(raw[key])) result[key]=raw[key];
  return result;
}

export function createQueueDetails(document,raw,{key='',available=true}={}) {
  const node = (tag,text) => {const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
  const receipt = validateQueueStatus(raw);
  if (!receipt) {
    const unknown=node('small',available ? 'Aufgabenauswahl nicht bestätigt' : 'Aufgabenauswahl nicht verfügbar');
    unknown.className='worker-queue-details text-muted';return unknown;
  }
  const details=node('details');details.className='worker-queue-details';
  const stableKey=typeof key==='string' && key.length<=120 ? key : '';
  details.open=stableKey ? openStates.get(stableKey)===true : false;
  if(stableKey)details.addEventListener('toggle',()=>{
    if(openStates.size>=256 && !openStates.has(stableKey))openStates.delete(openStates.keys().next().value);
    openStates.set(stableKey,details.open);
  });
  details.append(node('summary','Letzte Aufgabenauswahl: '+reasons[receipt.reason]));
  const source=node('p','Kanonische Task-API · '+(receipt.authority_mode==='local'?'lokale Autorität':'entfernte Autorität')+' · ');
  const time=node('time',new Date(receipt.observed_at).toLocaleString('de-DE'));
  time.dateTime=receipt.observed_at;source.append(time);details.append(source);
  details.append(node('p',receipt.candidate_count+' Kandidaten · '+receipt.matched_count+' Auswahlmatches · '
    +receipt.attempted_count+' Übernahmeversuche · '+receipt.scanned_pages+' Seiten · '
    +(receipt.scan_complete?'Suche vollständig':'Suche unvollständig')));
  if(receipt.selected_task_id) {
    const link=node('a','Task #'+receipt.selected_task_id);link.href='/tasks?task='+receipt.selected_task_id;
    details.append(link);
  }
  const list=node('ul');
  for(const [reason,value] of Object.entries(receipt.rejected_counts))if(value>0)list.append(node('li',rejections[reason]+': '+value));
  if(list.children.length)details.append(list);
  details.append(node('small','Datierter Auswahlbeleg; kein Nachweis aktueller Inferenz oder fachlicher Ergebnisqualität.'));
  return details;
}

export function appendQueueDetails(document,card,raw,options) {
  for(const old of card.querySelectorAll('.worker-queue-details'))old.remove();
  card.append(createQueueDetails(document,raw,options));
}
