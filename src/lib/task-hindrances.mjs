// SPDX-License-Identifier: MIT
// Adapted conceptually from BACH #2254's five-group WIP. Exact source pin in docs/task-hindrances.md.
// Read observations only; no pickup/admission/claim logic and no configuration writes.
export const HINDRANCE_GROUPS = [
  {id:'lease',label:'Lease und Belegung'},
  {id:'status',label:'Status und Abhängigkeiten'},
  {id:'policy',label:'Abschlussregeln und Ausführungsrechte'},
  {id:'binding',label:'Modell und Zuständigkeit'},
  {id:'versions',label:'Versionsbindung und Rückgabe'},
];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const present = value => typeof value === 'string' && value.trim().length > 0;
const text = value => value === null || value === undefined || value === '' ? 'Nicht angegeben' : String(value);
const entry = (value,kind='information') => ({text:value,kind});
function unavailable(message) {return entry(message,'unavailable');}
async function responseData(response) {
  if(!response.ok)throw new Error('Nicht verfügbar (HTTP '+response.status+').');
  const raw=await response.text();if(raw.length>128*1024)throw new Error('Antwort ist zu groß.');
  try{return JSON.parse(raw);}catch{throw new Error('Antwort ist nicht lesbar.');}
}
export async function readNativeTaskLease(id) {
  if(!positive(id))throw new Error('Ungültige Task-ID.');
  return responseData(await fetch(`/api/tasks/${id}/lease`));
}
export async function readNativeTaskPolicy(id) {
  if(!positive(id))throw new Error('Ungültige Task-ID.');
  return responseData(await fetch(`/api/tasks/${id}/worker-policy`));
}
function leaseMatches(task,lease) {
  if(!object(lease)||lease.task_id!==Number(task.id)||lease.task_version!==task.task_version||
    lease.status!==task.status||typeof lease.leased!=='boolean'||typeof lease.legacy!=='boolean'||
    !Number.isSafeInteger(lease.fence)||lease.fence<0||!stamp(lease.server_now))return false;
  if(lease.leased) {
    if(!object(lease.holder)||!present(lease.holder.worker_id))return false;
    // Native legacy claims with an unreadable claimed_at remain held with unknown expiry.
    if(!(lease.legacy&&lease.expires_at===null)&&(!stamp(lease.expires_at)||
       Date.parse(lease.expires_at)<=Date.parse(lease.server_now)))return false;
  }
  return true;
}
function policyMatches(task,policy) {
  const e=policy?.effective;
  return object(policy)&&policy.schema==='bach.task-worker-policy-override.v1'&&policy.availability==='available'&&
    policy.task_id===Number(task.id)&&policy.task_version===task.task_version&&sha(policy.configuration_version)&&
    object(e)&&e.contract_version==='worker-review-policy.v1alpha1'&&present(e.policy_version)&&
    present(e.effective_mode)&&['task_override','system_default'].includes(e.policy_source)&&
    e.state==='not_evaluated'&&['user_review_required','github_external_review','allow_review_task_pickup'].every(key=>typeof e[key]==='boolean');
}
export function buildTaskHindrances({task,lease=null,policy=null,leaseError=null,policyError=null}={}) {
  const validTask=object(task)&&positive(Number(task.id))&&present(task.status)&&sha(task.task_version);
  const leaseValid=validTask&&leaseMatches(task,lease),policyValid=validTask&&policyMatches(task,policy);
  const values=Object.fromEntries(HINDRANCE_GROUPS.map(group=>[group.id,[]]));
  if(leaseValid) {
    if(lease.leased) {
      values.lease.push(entry((lease.legacy?'Älterer Claim':'Lease')+' belegt die Aufgabe zum beobachteten Zeitpunkt.','observed'));
      values.lease.push(entry('Halter: '+lease.holder.worker_id));
      values.lease.push(entry('Host: '+text(lease.holder.host)));
      values.lease.push(entry('Beobachtet: '+lease.server_now+' · Ende: '+(lease.expires_at===null?'Nicht bestätigt':lease.expires_at)));
    } else values.lease.push(entry('Zum Beobachtungszeitpunkt ist keine aktive Lease belegt.'));
    // own is absent without a private X-Lease-Id. Absence/false does not identify a foreign device.
    values.lease.push(entry('Diese Ansicht bestimmt nicht, ob ein bestimmter Worker die Lease selbst hält.'));
  } else values.lease.push(unavailable(leaseError||'Lease und aktuelle Taskversion sind nicht gemeinsam bestätigt. Bitte neu öffnen.'));
  if(validTask) {
    values.status.push(entry('Status: '+text(task.status)));
    values.status.push(Object.hasOwn(task,'depends_on')?entry('Vorgänger: '+text(task.depends_on)):unavailable('Vorgänger sind nicht verfügbar.'));
    if(typeof task.is_blocked_by_dep==='boolean')values.status.push(task.is_blocked_by_dep?
      entry('Das Backend meldet eine blockierende Abhängigkeit.','hindrance'):
      entry('Das Backend meldet keine blockierende Abhängigkeit.'));
    else values.status.push(unavailable('Die Abhängigkeitsprüfung ist nicht bestätigt.'));
    for(const [field,label] of [['required_model','Gewünschtes Modell'],['assigned_slot','Gespeicherte Bindung'],['assigned_to','Zuständigkeit']])
      values.binding.push(Object.hasOwn(task,field)?entry(label+': '+text(task[field])):unavailable(label+': nicht verfügbar.'));
    values.binding.push(entry('Ob diese Angaben die Auswahl begrenzen, hängt von den wirksamen Regeln des ausführenden Workers ab.'));
  } else {
    values.status.push(unavailable('Die aktuelle Taskidentität und Inhaltsversion sind nicht bestätigt.'));
    values.binding.push(unavailable('Modell- und Zuständigkeitsangaben sind nicht bestätigt.'));
  }
  if(policyValid) {
    const e=policy.effective;
    values.policy.push(entry('Abschlussmodus: '+e.effective_mode));
    values.policy.push(entry('Nutzerabnahme erforderlich: '+(e.user_review_required?'Ja':'Nein')));
    values.policy.push(entry('Externes GitHub-Review: '+(e.github_external_review?'Ja':'Nein')));
    values.policy.push(entry('Review-Aufgaben aufnehmen: '+(e.allow_review_task_pickup?'Ja':'Nein')));
    values.policy.push(entry('Konfigurationsbasis: '+(e.policy_source==='task_override'?'Taskanpassung':'Systemstandard')+' · Regelversion '+e.policy_version));
    values.policy.push(entry('Die tatsächliche Abschlussprüfung wurde hier nicht ausgewertet.'));
  } else values.policy.push(unavailable(policyError||'Die Abschlussregeln dieser Taskversion sind nicht bestätigt.'));
  values.policy.push(unavailable('Werkzeug- und Ausführungsrechte eines bestimmten Workers sind aus diesen Abschlussregeln nicht ableitbar.'));
  if(validTask)values.versions.push(entry('Taskversion: '+task.task_version));
  if(leaseValid)values.versions.push(entry('Leasebeobachtung: gleiche Inhaltsversion · Fence '+lease.fence));
  if(policyValid)values.versions.push(entry('Regelkonfiguration: '+policy.configuration_version));
  values.versions.push(unavailable('Ein versionsgebundener unveränderter Rückgabeversuch ist aus diesen Antworten nicht belegt.'));
  return {taskId:validTask?Number(task.id):null,groups:HINDRANCE_GROUPS.map(group=>({...group,entries:values[group.id]}))};
}
export async function readTaskHindrances(task) {
  const id=Number(task?.id);
  const [lease,policy]=await Promise.allSettled([readNativeTaskLease(id),readNativeTaskPolicy(id)]);
  return buildTaskHindrances({task,
    lease:lease.status==='fulfilled'?lease.value:null,
    policy:policy.status==='fulfilled'?policy.value:null,
    leaseError:lease.status==='rejected'?'Leasebeobachtung nicht verfügbar.':null,
    policyError:policy.status==='rejected'?'Abschlussregeln nicht verfügbar.':null,
  });
}
export function renderTaskHindrances(container,model) {
  const document=container.ownerDocument;container.replaceChildren();
  const note=document.createElement('p');note.className='muted';
  note.textContent='Lesende Momentaufnahme. Eine Kandidatenliste, ein offener Status oder fehlende Angaben bestätigen keine Übernahmeberechtigung.';container.append(note);
  const grid=document.createElement('div');grid.className='task-hindrances-grid';
  for(const group of model.groups) {
    const section=document.createElement('section'),title=document.createElement('h4'),list=document.createElement('ul');
    title.textContent=group.label;section.append(title,list);
    for(const value of group.entries) {
      const item=document.createElement('li');item.textContent=value.text;item.dataset.kind=value.kind;list.append(item);
    }
    grid.append(section);
  }
  container.append(grid);
}
