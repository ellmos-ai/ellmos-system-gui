export const integer=(n,min=0,max=1000000000)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
export function pageShape(data,key,schema){
  if(data?.schema!==schema||!Array.isArray(data[key])||!integer(data.total)||!integer(data.offset,0,100000)||
     !integer(data.limit,1,100)||data[key].length>data.limit||(data[key].length>0&&data.offset+data[key].length>data.total)||typeof data.has_more!=='boolean'||
     data.has_more!==(data.offset+data[key].length<data.total))
    throw new Error('Verlauf wurde nicht bestätigt. Bitte aktualisieren.');
  return data;
}
export const SOURCES=['user','buddha','worker','system'];
export function validateSessionPage(data,{agent_id=null,archive='all',offset=0,limit=25,source='all',problems=false}={}){
  pageShape(data,'sessions','bach.chat-sessions.v1');
  if(data.source!=='session_snapshots'||data.snapshot_type!=='chat-transcript.v1'||
     data.agent_id!==agent_id||data.context!==(agent_id===null?'global':'profile')||data.archive!==archive||
     data.offset!==offset||data.limit!==limit||!integer(data.save_limits?.max_messages,1,10000)||
     !integer(data.save_limits?.max_content_chars,1,1000000))throw new Error('Dialogquelle oder Auswahl nicht bestätigt.');
  // Filters must be confirmed by the backend; an older backend that ignores them would show the wrong list silently.
  if(source!=='all'&&data.source_filter!==source)throw new Error('Quellenfilter vom Backend nicht bestätigt.');
  if(problems&&data.problems!==true)throw new Error('Problemfilter vom Backend nicht bestätigt.');
  if(data.source_counts!==undefined&&(typeof data.source_counts!=='object'||data.source_counts===null||SOURCES.some(k=>!integer(data.source_counts[k]))))
    throw new Error('Quellenzähler nicht bestätigt.');
  const seen=new Set();
  for(const row of data.sessions){
    if(!integer(row.id,1,2147483647)||seen.has(row.id)||typeof row.name!=='string'||
       typeof row.chat_id!=='string'||!integer(row.stored_message_count,0,1000)||typeof row.archived!=='boolean'||
       (agent_id===null?(row.context_class==='agent-profile'||row.chat_id.startsWith('agent:')):
       row.agent_id!==agent_id||row.context_class!=='agent-profile')||
       (archive==='current'&&row.archived)||(archive==='archived'&&!row.archived)||
       (row.source!==undefined&&!SOURCES.includes(row.source))||(source!=='all'&&row.source!==source)||
       (row.failed_count!==undefined&&!integer(row.failed_count))||(problems&&!(row.failed_count>0)))
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
export async function read(url,signal){
  const response=await fetch(url,{cache:'no-store',signal});
  let data;try{data=await response.json();}catch{throw new Error('Verlaufsantwort nicht lesbar.');}
  if(!response.ok||data.error)throw new Error(typeof data.detail==='string'?data.detail+' (HTTP '+response.status+')':'Verlauf nicht verfügbar (HTTP '+response.status+')');
  return data;
}
export function pageOptions(options={}){
  const offset=options.offset??0,limit=options.limit??25;
  if(!integer(offset,0,100000)||!integer(limit,1,100))throw new Error('Ungültige Verlaufsseite.');
  return {offset,limit};
}
export async function loadSessionPage(options={}){
  const {offset,limit}=pageOptions(options),agent_id=options.agent_id??null,archive=options.archive??'all';
  if((agent_id!==null&&!integer(agent_id,1,2147483647))||!['all','current','archived'].includes(archive))throw new Error('Ungültige Dialogauswahl.');
  const source=options.source??'all',problems=options.problems===true;
  if(source!=='all'&&!SOURCES.includes(source))throw new Error('Ungültige Quellenauswahl.');
  const query=new URLSearchParams({offset:String(offset),limit:String(limit),archive});
  if(source!=='all')query.set('source',source);
  if(problems)query.set('problems','true');
  if(agent_id!==null)query.set('agent_id',String(agent_id));
  return validateSessionPage(await read('/api/agent-history/sessions?'+query,options.signal),{offset,limit,agent_id,archive,source,problems});
}
export async function loadSession(snapshot_id,agent_id=null,{signal,include_tools=false}={}){
  if(!integer(snapshot_id,1,2147483647)||(agent_id!==null&&!integer(agent_id,1,2147483647)))throw new Error('Ungültige Dialogkennung.');
  const query=new URLSearchParams();if(agent_id!==null)query.set('agent_id',String(agent_id));if(include_tools===true)query.set('include_tools','true');
  return validateSession(await read('/api/agent-history/sessions/'+snapshot_id+(query.size?'?'+query:''),signal),{snapshot_id,agent_id});
}
