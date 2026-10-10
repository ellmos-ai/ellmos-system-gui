import {loadSessionPage,loadSession,loadTaskPage,loadMemoryNotes} from '../lib/agent-history.mjs';
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text??'');if(cls)n.className=cls;return n;};
const stamp=value=>{const date=new Date(value??'');return Number.isFinite(date.getTime())?date.toLocaleString('de-DE'):'Zeit nicht erfasst';};
const labels={pending:'Offen',in_progress:'In Bearbeitung',done:'Erledigt',blocked:'Blockiert',cancelled:'Abgebrochen',review:'Im Review'};
const eventLabels={lease_acquire:'Aufgabe übernommen',lease_renew:'Lease verlängert',lease_release:'Aufgabe zurückgegeben oder abgeschlossen',
  lease_update:'Taskinhalt aktualisiert',lease_decompose:'Aufgabe zerlegt',field_change:'Feld geändert',status_change:'Status geändert'};
function initialize(){
  const root=document.getElementById('native-history');if(!root)return;
  let tab='sessions',sessionOffset=0,taskOffset=0,epoch=0,detailEpoch=0,currentRequest=null;
  const profile=document.getElementById('history-profile'),archive=document.getElementById('history-archive'),
    taskInput=document.getElementById('history-task'),taskStatus=document.getElementById('history-task-status'),
    content=document.getElementById('history-content'),status=document.getElementById('history-status'),
    count=document.getElementById('history-count'),prev=document.getElementById('history-prev'),next=document.getElementById('history-next'),
    modal=document.getElementById('history-dialog'),detail=document.getElementById('history-dialog-content');
  const selectedProfile=()=>profile.value?Number(profile.value):null;
  function taskLink(id,title='Aufgabe #'+id){const a=node('a',title,'btn btn-secondary btn-sm');a.href='/tasks?task='+id;return a;}
  function clearDetail(){detailEpoch++;if(modal.open)modal.close();detail.replaceChildren();}
  modal.querySelector('[data-close]').addEventListener('click',()=>modal.close());
  modal.addEventListener('close',()=>{detailEpoch++;detail.replaceChildren();});
  async function openDialog(row){
    const request=++detailEpoch,agent_id=selectedProfile();
    document.getElementById('history-dialog-title').textContent=row.name||'Gespeicherter Dialog';
    detail.replaceChildren(node('p','Gespeicherten Ausschnitt laden…'));
    if(!modal.open)modal.showModal();
    try{
      const data=await loadSession(row.id,agent_id);
      if(request!==detailEpoch||!modal.open||selectedProfile()!==agent_id)return;
      detail.replaceChildren(node('p',stamp(data.updated_at||data.created_at)+' · '+(data.archived?'Archivierter Ausschnitt':'Aktueller gespeicherter Ausschnitt'),'text-muted'));
      if(!data.messages.length)detail.append(node('p','Keine sichtbaren Nachrichten gespeichert.'));
      for(const message of data.messages){
        const card=node('article',undefined,'history-message');card.dataset.role=message.role;
        const title=message.role==='user'?'Nutzer':message.role==='assistant'?'Agent':'Werkzeugergebnis';
        card.append(node('h3',title+(message.answer_status==='failed'?' · Fehlgeschlagen':'')));
        card.append(node('pre',message.content||'Kein sichtbarer Ausgabetext gespeichert.'));
        for(const id of message.completed_task_ids||[])card.append(taskLink(id,'Referenzierte Aufgabe #'+id));
        detail.append(card);
      }
    }catch(error){if(request===detailEpoch&&modal.open)detail.replaceChildren(node('p','Dialog nicht verfügbar: '+error.message,'history-error'));}
  }
  function makePager(data,offset){
    prev.disabled=offset===0;next.disabled=!data.has_more;
    const length=data[tab==='sessions'?'sessions':'events'].length;
    count.textContent=data.total===0?'Keine Einträge':length?(offset+1)+'–'+(offset+length)+' von '+data.total:'Keine Einträge auf dieser Seite · '+data.total+' insgesamt';
  }
  async function refresh(reset=false){
    if(reset){sessionOffset=0;taskOffset=0;}
    const request=++epoch;currentRequest?.abort();currentRequest=new AbortController();
    const signal=currentRequest.signal;prev.disabled=true;next.disabled=true;
    count.textContent='Wird geprüft…';status.textContent='Lade Verlauf…';status.dataset.error='false';content.replaceChildren();
    try{
      if(tab==='sessions'){
        const data=await loadSessionPage({offset:sessionOffset,agent_id:selectedProfile(),archive:archive.value,signal});
        if(request!==epoch)return;
        status.textContent='Gespeicherte Ausschnitte · regulär höchstens '+data.save_limits.max_messages+' Nachrichten pro Transkript und '+data.save_limits.max_content_chars.toLocaleString('de-DE')+' Zeichen pro Nachricht.';
        if(!data.sessions.length)content.append(node('p','Keine gespeicherten Dialoge in dieser Auswahl.','text-muted'));
        for(const row of data.sessions){
          const card=node('article',undefined,'history-card');
          card.append(node('h2',row.name||'Gespeicherter Dialog'));
          card.append(node('p',stamp(row.created_at)+' · '+(row.archived?'Archiviert':'Aktuell gespeichert')+' · '+row.stored_message_count+' gespeicherte Nachrichten','text-muted'));
          const button=node('button','Dialog lesen','btn btn-secondary');button.type='button';button.dataset.snapshotId=String(row.id);
          button.addEventListener('click',()=>openDialog(row));card.append(button);content.append(card);
        }
        makePager(data,sessionOffset);
      }else if(tab==='tasks'){
        const task_id=taskInput.value?Number(taskInput.value):null;
        const data=await loadTaskPage({offset:taskOffset,task_id,status:taskStatus.value||null,signal});
        if(request!==epoch)return;
        status.textContent='Dauerhaft erfasste Aufgabenereignisse. Der Statusfilter verwendet den aktuellen Aufgabenstatus.';
        if(!data.events.length)content.append(node('p','Keine Taskereignisse in dieser Auswahl.','text-muted'));
        for(const event of data.events){
          const card=node('article',undefined,'history-card');
          card.append(node('h2',event.title));
          card.append(node('p',stamp(event.changed_at)+' · '+(eventLabels[event.action]||event.action)+' · '+event.field,'text-muted'));
          if(event.old_status||event.new_status)card.append(node('p',(labels[event.old_status]||'Nicht erfasst')+' → '+(labels[event.new_status]||'Nicht erfasst')));
          card.append(node('p','Aktuell: '+(labels[event.current_task_status]||'Nicht im Register')));
          card.append(taskLink(event.task_id));content.append(card);
        }
        makePager(data,taskOffset);
      }else{
        const notes=await loadMemoryNotes({signal});if(request!==epoch)return;
        status.textContent='Erfasste Gedächtniszusammenfassungen. Die gespeicherten Dialoge stehen im Tab Dialoge.';
        count.textContent=notes.length+' jüngste Notizen';
        if(!notes.length)content.append(node('p','Keine Gedächtniszusammenfassungen vorhanden.','text-muted'));
        for(const note of notes){
          const card=node('article',undefined,'history-card');card.append(node('h2',note.summary||'Ohne Zusammenfassung'));
          card.append(node('p',stamp(note.started_at)+(note.ended_at?' – '+stamp(note.ended_at):''),'text-muted'));content.append(card);
        }
      }
    }catch(error){
      if(request!==epoch||error.name==='AbortError')return;
      status.textContent='Verlauf nicht verfügbar: '+error.message;status.dataset.error='true';count.textContent='Nicht verfügbar';content.replaceChildren();
    }
  }
  for(const button of root.querySelectorAll('[data-history-tab]'))button.addEventListener('click',()=>{
    clearDetail();tab=button.dataset.historyTab;
    for(const b of root.querySelectorAll('[data-history-tab]'))b.setAttribute('aria-pressed',String(b===button));
    const inbox=tab==='inbox';
    document.getElementById('history-panel').hidden=inbox;document.getElementById('inbox-panel').hidden=!inbox;
    const url=new URL(location.href);if(inbox)url.searchParams.set('tab','inbox');else url.searchParams.delete('tab');history.replaceState(null,'',url);
    document.getElementById('history-session-filters').hidden=tab!=='sessions';
    document.getElementById('history-task-filters').hidden=tab!=='tasks';
    document.getElementById('history-pager').hidden=tab==='notes';
    if(inbox)document.dispatchEvent(new CustomEvent('bach:inbox-show'));else refresh();
  });
  for(const input of [profile,archive,taskStatus])input.addEventListener('change',()=>{clearDetail();refresh(true);});
  document.getElementById('history-task-form').addEventListener('submit',event=>{event.preventDefault();if(taskInput.checkValidity())refresh(true);});
  document.getElementById('history-refresh').addEventListener('click',()=>{if(tab==='inbox')document.dispatchEvent(new CustomEvent('bach:inbox-refresh'));else refresh();});
  prev.addEventListener('click',()=>{if(tab==='sessions')sessionOffset=Math.max(0,sessionOffset-25);else taskOffset=Math.max(0,taskOffset-25);refresh();});
  next.addEventListener('click',()=>{if(tab==='sessions')sessionOffset+=25;else taskOffset+=25;refresh();});
  async function profiles(){
    try{
      const response=await fetch('/api/agents',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();if(!Array.isArray(data.agents))throw new Error('Profilantwort ungültig');
      for(const item of data.agents){
        if(item.profile_chat_ready===true&&Number.isSafeInteger(item.id)&&item.id>0)
          profile.append(new Option(item.display_name||item.name||'Profil #'+item.id,String(item.id)));
      }
      const params=new URLSearchParams(location.search),selected=Number(params.get('profile'));
      if(selected>0&&Array.from(profile.options).some(o=>o.value===String(selected)))profile.value=String(selected);
    }catch{document.getElementById('history-profile-state').textContent='Profilauswahl derzeit nicht verfügbar.';}
    const params=new URLSearchParams(location.search),task=Number(params.get('task'));
    if(Number.isSafeInteger(task)&&task>0&&task<=2147483647){taskInput.value=String(task);root.querySelector('[data-history-tab="tasks"]').click();}
    else if(params.get('tab')==='inbox')root.querySelector('[data-history-tab="inbox"]').click();
    else await refresh();
  }
  profiles();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
