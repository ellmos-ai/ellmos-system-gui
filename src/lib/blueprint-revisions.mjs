// SPDX-License-Identifier: MIT
export const REVISION_SCHEMA = 'bach.blueprint-revisions.v1';
const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function reject() { throw new Error('Versionsdaten sind unvollständig oder widersprüchlich. Bitte neu laden.'); }
function envelope(data, id) {
  if (!data || data.schema !== REVISION_SCHEMA || data.blueprint_id !== id) reject();
  return data;
}
async function responseData(response) {
  if (!response.ok) throw new Error(response.status === 409
    ? 'Die Vorlage wurde inzwischen geändert. Bitte neu laden; es wurde keine Wiederholung ausgelöst.'
    : 'Versionsdaten nicht verfügbar (HTTP '+response.status+').');
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) reject();
  try { return JSON.parse(text); } catch { reject(); }
}
export async function readHistory(id, before = null) {
  if (!positive(id) || (before !== null && !positive(before))) reject();
  const data = envelope(await responseData(await fetch(`/api/agent-studio/blueprints/${id}/revisions?limit=25${before === null ? '' : '&before_version='+before}`)), id);
  if (typeof data.storage_ready !== 'boolean' || data.legacy_history_complete !== false ||
      typeof data.definition_deleted !== 'boolean' || !Array.isArray(data.revisions) || data.revisions.length > 25 ||
      (data.definition_deleted ? data.current_version !== null : !positive(data.current_version)) ||
      (data.next_before_version !== null && !positive(data.next_before_version))) reject();
  let previous = before ?? Infinity;
  for (const item of data.revisions) {
    if (!positive(item?.version) || item.version >= previous || (positive(data.current_version) && item.version > data.current_version) || !hash(item.snapshot_sha256) ||
        typeof item.recorded_at !== 'string' || !Number.isFinite(Date.parse(item.recorded_at))) reject();
    previous = item.version;
  }
  if (data.next_before_version !== null && (!data.revisions.length || data.next_before_version !== previous)) reject();
  return data;
}
export async function readRevision(id, version) {
  if (!positive(id) || !positive(version)) reject();
  const data = envelope(await responseData(await fetch(`/api/agent-studio/blueprints/${id}/revisions/${version}`)), id);
  if (data.version !== version || !hash(data.snapshot_sha256) || !data.snapshot ||
      data.snapshot.id !== id || data.snapshot.version !== version) reject();
  return data;
}
export async function readRevisionDiff(id, from, to) {
  if (![id,from,to].every(positive)) reject();
  const data = envelope(await responseData(await fetch(`/api/agent-studio/blueprints/${id}/revisions/diff?from_version=${from}&to_version=${to}`)), id);
  if (data.from_version !== from || data.to_version !== to || !hash(data.from_sha256) || !hash(data.to_sha256) ||
      typeof data.diff !== 'string' || [...data.diff].length > 128*1024 || typeof data.truncated !== 'boolean' ||
      !Array.isArray(data.changed_fields) || data.changed_fields.some(value => typeof value !== 'string')) reject();
  return data;
}
export async function restoreRevision(id, version, expected) {
  if (![id,version,expected].every(positive) || expected >= Number.MAX_SAFE_INTEGER) reject();
  const data = await responseData(await fetch(`/api/agent-studio/blueprints/${id}/revisions/${version}/restore`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expected_version:expected}),
  }));
  if (data?.success !== true || data.id !== id || data.version !== expected+1 ||
      data.restored_from_version !== version || data.status !== 'saved' || !hash(data.snapshot_sha256)) reject();
  return data;
}

export function createRevisionDialog({document, onRestored}) {
  const get = id => document.getElementById(id);
  const dialog = get('revision-history');
  let state = null, epoch = 0, busy = false, mutating = false;
  const status = (text, error=false) => {
    get('revision-status').textContent=text;get('revision-status').dataset.error=String(error);
  };
  function controls() {
    const count=state?.items.length||0;
    get('revision-from').disabled=busy||!count;get('revision-to').disabled=busy||!count;
    get('revision-refresh').disabled=busy;
    get('revision-more').disabled=busy||!state?.next;
    get('revision-compare').disabled=busy||!count||get('revision-from').value===get('revision-to').value;
    get('revision-restore').disabled=busy||!state||state.stale||state.blueprint.is_template===1||
      !positive(state.current)||state.loaded!==Number(get('revision-from').value)||state.loaded===state.current;
    get('revision-close').disabled=mutating;
  }
  function clearPreview() {
    get('revision-content').textContent='';get('revision-hash').textContent='';
    get('revision-diff').textContent='';if(state)state.loaded=null;
  }
  function options() {
    const oldFrom=get('revision-from').value,oldTo=get('revision-to').value;
    for(const id of ['revision-from','revision-to']) {
      const select=get(id);select.replaceChildren();
      for(const item of state.items) {
        const option=document.createElement('option');option.value=String(item.version);
        option.textContent='Version '+item.version+' · '+new Date(item.recorded_at).toLocaleString();
        select.append(option);
      }
    }
    get('revision-from').value=state.items.some(x=>String(x.version)===oldFrom)?oldFrom:String(state.items[1]?.version??state.items[0]?.version??'');
    get('revision-to').value=state.items.some(x=>String(x.version)===oldTo)?oldTo:String(state.items[0]?.version??'');
    get('revision-more').hidden=state.next===null;
  }
  async function detail(token) {
    clearPreview();const id=state.blueprint.id,version=Number(get('revision-from').value);
    if(!positive(version))return;
    const data=await readRevision(id,version);
    if(token!==epoch)return;
    const recorded=state.items.find(item=>item.version===version);
    if(!recorded||recorded.snapshot_sha256!==data.snapshot_sha256)reject();
    get('revision-content').textContent=JSON.stringify(data.snapshot,null,2);
    get('revision-hash').textContent='SHA-256: '+data.snapshot_sha256;
    state.loaded=version;
  }
  async function load(token, more=false) {
    const data=await readHistory(state.blueprint.id,more?state.next:null);
    if(token!==epoch)return;
    if(more&&(data.current_version!==state.current||data.definition_deleted!==state.deleted)) {
      state.stale=true;throw new Error('Die Vorlage wurde während des Ladens geändert. Bitte neu laden.');
    }
    if(more&&data.revisions.some(item=>state.items.some(old=>old.version===item.version)))reject();
    state.items=more?[...state.items,...data.revisions]:data.revisions;
    state.next=data.next_before_version;state.current=data.current_version;state.deleted=data.definition_deleted;
    get('revision-summary').textContent=data.definition_deleted?'Die aktuelle Vorlage wurde entfernt. Aufgezeichnete Versionen bleiben lesbar.':
      'Aktuelle Vorlage: Version '+state.current+'. Wiederherstellen erstellt eine neue Version und lässt bestehende Agenten unverändert.';
    get('revision-policy').textContent=state.blueprint.is_template===1?
      'Systemvorlagen bleiben geschützt. Erstelle eine Kopie für eigene Änderungen.':
      'Nicht aufgezeichnete ältere Änderungen sind nicht verfügbar.';
    options();await detail(token);
    if(token!==epoch)return;
    state.stale=false;
    status(state.items.length?'Aufgezeichnete Versionen geladen.':data.storage_ready?
      'Für diese Vorlage wurden noch keine Versionen aufgezeichnet.':'Die Versionsaufzeichnung ist auf diesem Backend noch nicht eingerichtet.');
  }
  async function perform(operation) {
    if(busy||!state)return;
    const token=epoch;busy=true;controls();
    try { await operation(token); }
    catch(error) { if(token===epoch){state.stale=true;status(error.message,true);} }
    finally { if(token===epoch){busy=false;mutating=false;controls();} }
  }
  get('revision-refresh').addEventListener('click',()=>perform(token=>load(token)));
  get('revision-more').addEventListener('click',()=>perform(token=>load(token,true)));
  get('revision-from').addEventListener('change',()=>perform(async token=>{await detail(token);if(token===epoch)status('Gespeicherte Definition geladen.');}));
  get('revision-to').addEventListener('change',()=>{get('revision-diff').textContent='';controls();});
  get('revision-compare').addEventListener('click',()=>perform(async token=>{
    get('revision-diff').textContent='';
    const from=Number(get('revision-from').value),to=Number(get('revision-to').value);
    const data=await readRevisionDiff(state.blueprint.id,from,to);
    if(token!==epoch)return;
    for(const [version,sha] of [[from,data.from_sha256],[to,data.to_sha256]])
      if(state.items.find(item=>item.version===version)?.snapshot_sha256!==sha)reject();
    get('revision-diff').textContent=data.diff||'Keine Unterschiede.';
    status(data.truncated?'Der Vergleich ist gekürzt. Die Einzeldefinitionen sind vollständig lesbar.':'Vergleich geladen.');
  }));
  get('revision-restore').addEventListener('click',()=>perform(async token=>{
    const {blueprint,current,loaded,stale}=state;
    if(stale||blueprint.is_template===1||!positive(current)||!positive(loaded)||loaded===current)reject();
    if(!document.defaultView.confirm('Version '+loaded+' als neue Vorlagenversion '+(current+1)+' wiederherstellen? Bestehende Agenten behalten ihre Konfiguration.'))return;
    mutating=true;controls();
    state.stale=true;
    const saved=await restoreRevision(blueprint.id,loaded,current);
    if(token!==epoch)return;
    await onRestored(saved);dialog.close();
  }));
  dialog.addEventListener('cancel',event=>{if(mutating)event.preventDefault();});
  dialog.addEventListener('close',()=>{epoch++;state=null;busy=false;mutating=false;});
  return {async open(blueprint, contract) {
    if(contract!==REVISION_SCHEMA||!positive(blueprint?.id))
      throw new Error('Die Versionshistorie ist auf diesem Backend noch nicht verfügbar.');
    const token=++epoch;busy=true;mutating=false;
    state={blueprint,items:[],next:null,current:null,deleted:false,loaded:null,stale:false};
    get('revision-title').textContent='Versionen · '+(blueprint.title||blueprint.name);
    get('revision-from').replaceChildren();get('revision-to').replaceChildren();clearPreview();
    get('revision-summary').textContent='Versionen werden geladen…';get('revision-policy').textContent='';status('');controls();
    if(!dialog.open)dialog.showModal();
    try {await load(token);}catch(error){if(token===epoch)status(error.message,true);}
    finally {if(token===epoch){busy=false;controls();}}
  }};
}
