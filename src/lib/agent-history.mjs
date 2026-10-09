const statuses=new Set(['pending','in_progress','done','blocked','cancelled','review']);
const integer=(n,min=0,max=1000000000)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
function pageShape(data,key,schema){
  if(data?.schema!==schema||!Array.isArray(data[key])||!integer(data.total)||!integer(data.offset,0,100000)||
     !integer(data.limit,1,100)||data[key].length>data.limit||(data[key].length>0&&data.offset+data[key].length>data.total)||typeof data.has_more!=='boolean'||
     data.has_more!==(data.offset+data[key].length<data.total))
    throw new Error('Verlauf wurde nicht bestätigt. Bitte aktualisieren.');
  return data;
}
export function validateSessionPage(data,{agent_id=null,archive='all',offset=0,limit=25}={}){
  pageShape(data,'sessions','bach.chat-sessions.v1');
  if(data.source!=='session_snapshots'||data.snapshot_type!=='chat-transcript.v1'||
     data.agent_id!==agent_id||data.context!==(agent_id===null?'global':'profile')||data.archive!==archive||
     data.offset!==offset||data.limit!==limit||!integer(data.save_limits?.max_messages,1,10000)||
     !integer(data.save_limits?.max_content_chars,1,1000000))throw new Error('Dialogquelle oder Auswahl nicht bestätigt.');
  const seen=new Set();
  for(const row of data.sessions){
    if(!integer(row.id,1,2147483647)||seen.has(row.id)||typeof row.name!=='string'||
       typeof row.chat_id!=='string'||!integer(row.stored_message_count,0,1000)||typeof row.archived!=='boolean'||
       (agent_id===null?(row.context_class==='agent-profile'||row.chat_id.startsWith('agent:')):
       row.agent_id!==agent_id||row.context_class!=='agent-profile')||
       (archive==='current'&&row.archived)||(archive==='archived'&&!row.archived))
      throw new Error('Dialogeintrag gehört nicht zur bestätigten Auswahl.');
    seen.add(row.id);
  }
  return data;
}
export function validateSession(data,{snapshot_id,agent_id=null}){
  if(data?.schema!=='bach.chat-session.v1'||data.source!=='session_snapshots'||
     data.snapshot_id!==snapshot_id||data.agent_id!==agent_id||data.context!==(agent_id===null?'global':'profile')||
     data.available_excerpt!==true||data.system_messages_included!==false||data.reasoning_included!==false||
     !integer(data.stored_message_count,0,1000)||!Array.isArray(data.messages)||data.messages.length>data.stored_message_count)
    throw new Error('Gespeicherter Dialog nicht bestätigt.');
  let previous=-1;
  for(const message of data.messages){
    if(!integer(message.index,0,999)||message.index<=previous||!['user','assistant','tool'].includes(message.role)||
       typeof message.content!=='string'||message.content.length>1000000||
       (message.answer_status!==undefined&&!['success','failed'].includes(message.answer_status))||
       (message.completed_task_ids!==undefined&&(!Array.isArray(message.completed_task_ids)||
        message.completed_task_ids.length>100||message.completed_task_ids.some(id=>!integer(id,1,2147483647)))))
      throw new Error('Dialog enthält unbestätigte Nachrichten.');
    previous=message.index;
  }
  return data;
}
export function validateTaskPage(data,{task_id=null,status=null,offset=0,limit=25}={}){
  pageShape(data,'events','bach.task-history.v1');
  if(data.source!=='task_history'||data.actors_included!==false||data.content_changes_included!==false||
     data.offset!==offset||data.limit!==limit)throw new Error('Taskquelle nicht bestätigt.');
  const seen=new Set();
  for(const event of data.events){
    if(!integer(event.id,1)||seen.has(event.id)||!integer(event.task_id,1,2147483647)||
       typeof event.title!=='string'||typeof event.action!=='string'||typeof event.field!=='string'||
       (task_id!==null&&event.task_id!==task_id)||(status!==null&&event.current_task_status!==status)||
       ['old_status','new_status','current_task_status'].some(k=>event[k]!==null&&!statuses.has(event[k])))
      throw new Error('Taskereignis gehört nicht zur bestätigten Auswahl.');
    seen.add(event.id);
  }
  return data;
}
async function read(url,signal){
  const response=await fetch(url,{cache:'no-store',signal});
  let data;try{data=await response.json();}catch{throw new Error('Verlaufsantwort nicht lesbar.');}
  if(!response.ok||data.error)throw new Error(typeof data.detail==='string'?data.detail+' (HTTP '+response.status+')':'Verlauf nicht verfügbar (HTTP '+response.status+')');
  return data;
}
function pageOptions(options={}){
  const offset=options.offset??0,limit=options.limit??25;
  if(!integer(offset,0,100000)||!integer(limit,1,100))throw new Error('Ungültige Verlaufsseite.');
  return {offset,limit};
}
export async function loadSessionPage(options={}){
  const {offset,limit}=pageOptions(options),agent_id=options.agent_id??null,archive=options.archive??'all';
  if((agent_id!==null&&!integer(agent_id,1,2147483647))||!['all','current','archived'].includes(archive))throw new Error('Ungültige Dialogauswahl.');
  const query=new URLSearchParams({offset:String(offset),limit:String(limit),archive});
  if(agent_id!==null)query.set('agent_id',String(agent_id));
  return validateSessionPage(await read('/api/agent-history/sessions?'+query,options.signal),{offset,limit,agent_id,archive});
}
export async function loadSession(snapshot_id,agent_id=null,{signal}={}){
  if(!integer(snapshot_id,1,2147483647)||(agent_id!==null&&!integer(agent_id,1,2147483647)))throw new Error('Ungültige Dialogkennung.');
  const query=new URLSearchParams();if(agent_id!==null)query.set('agent_id',String(agent_id));
  return validateSession(await read('/api/agent-history/sessions/'+snapshot_id+(query.size?'?'+query:''),signal),{snapshot_id,agent_id});
}
export async function loadTaskPage(options={}){
  const {offset,limit}=pageOptions(options),task_id=options.task_id??null,status=options.status??null;
  if((task_id!==null&&!integer(task_id,1,2147483647))||(status!==null&&!statuses.has(status)))throw new Error('Ungültige Taskauswahl.');
  const query=new URLSearchParams({offset:String(offset),limit:String(limit)});
  if(task_id!==null)query.set('task_id',String(task_id));if(status!==null)query.set('status',status);
  return validateTaskPage(await read('/api/agent-history/tasks?'+query,options.signal),{offset,limit,task_id,status});
}
export async function loadMemoryNotes({signal}={}){
  const data=await read('/api/memory/sessions?limit=25',signal);
  if(!Array.isArray(data.sessions)||!integer(data.count)||data.count!==data.sessions.length)throw new Error('Gedächtnisnotizen nicht bestätigt.');
  return data.sessions;
}
