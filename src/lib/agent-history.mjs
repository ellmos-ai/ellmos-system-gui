import {integer,pageShape,read,pageOptions} from './transcript-history.mjs';
export {validateSessionPage,validateSession,loadSessionPage,loadSession} from './transcript-history.mjs';
const statuses=new Set(['pending','in_progress','done','blocked','cancelled','review']);
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
