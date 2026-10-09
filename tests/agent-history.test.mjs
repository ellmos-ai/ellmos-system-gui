import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSessionPage,validateSession,validateTaskPage,loadSessionPage,loadSession,loadTaskPage,loadMemoryNotes} from '../src/lib/agent-history.mjs';
const row={id:1,name:'Grüße',chat_id:'gui-web',context_class:null,agent_id:null,archived:false,stored_message_count:2};
const page=(overrides={})=>({schema:'bach.chat-sessions.v1',source:'session_snapshots',snapshot_type:'chat-transcript.v1',
  context:'global',agent_id:null,archive:'all',sessions:[row],total:1,offset:0,limit:25,has_more:false,save_limits:{max_messages:40,max_content_chars:24000},...overrides});
const detail=(overrides={})=>({schema:'bach.chat-session.v1',source:'session_snapshots',snapshot_id:1,context:'global',agent_id:null,
  available_excerpt:true,system_messages_included:false,reasoning_included:false,stored_message_count:2,
  messages:[{index:0,role:'user',content:'Frage'},{index:1,role:'assistant',content:'Antwort',answer_status:'success',completed_task_ids:[2]}],...overrides});
const taskPage=(overrides={})=>({schema:'bach.task-history.v1',source:'task_history',total:1,offset:0,limit:25,has_more:false,
  actors_included:false,content_changes_included:false,events:[{id:3,task_id:2,title:'Aufgabe',action:'status_change',field:'status',
  old_status:'pending',new_status:'done',current_task_status:'done'}],...overrides});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
test('native transcript pages require source, context, actual count and retention metadata',()=>{
  assert.equal(validateSessionPage(page()).sessions[0].id,1);
  for(const data of [page({source:'memory_sessions'}),page({schema:'fake'}),page({total:0}),page({has_more:true}),
    page({save_limits:{max_messages:0,max_content_chars:2}}),page({sessions:[row,row],total:2}),
    page({agent_id:1}),page({sessions:[{...row,chat_id:'agent:1:abc'}]})])assert.throws(()=>validateSessionPage(data));
});
test('profile and archive filtering must match the chosen request',()=>{
  const chosen=page({context:'profile',agent_id:1,archive:'archived',sessions:[{...row,chat_id:'agent:1:abc',agent_id:1,context_class:'agent-profile',archived:true}]});
  assert.equal(validateSessionPage(chosen,{agent_id:1,archive:'archived'}),chosen);
  assert.throws(()=>validateSessionPage(chosen));
  assert.throws(()=>validateSessionPage(chosen,{agent_id:2,archive:'archived'}));
  assert.throws(()=>validateSessionPage(page({archive:'archived'}),{archive:'archived'}));
});
test('the viewer accepts only visible messages of the requested saved context',()=>{
  assert.equal(validateSession(detail(),{snapshot_id:1}).messages.length,2);
  for(const data of [detail({snapshot_id:2}),detail({reasoning_included:true}),detail({system_messages_included:true}),
    detail({context:'profile',agent_id:1}),detail({messages:[{index:0,role:'system',content:'prompt'}]}),
    detail({messages:[{index:1,role:'user',content:'a'},{index:0,role:'assistant',content:'b'}]}),
    detail({messages:[{index:0,role:'assistant',content:'a',completed_task_ids:['2']}]})])assert.throws(()=>validateSession(data,{snapshot_id:1}));
});
test('task metadata contains real task IDs and matches combinable filters',()=>{
  assert.equal(validateTaskPage(taskPage(),{task_id:2,status:'done'}).events[0].new_status,'done');
  assert.throws(()=>validateTaskPage(taskPage(),{task_id:3}));
  assert.throws(()=>validateTaskPage(taskPage(),{status:'pending'}));
  for(const data of [taskPage({source:'control_activity'}),taskPage({actors_included:true}),taskPage({content_changes_included:true}),
    taskPage({events:[{...taskPage().events[0],current_task_status:'invented'}]})])assert.throws(()=>validateTaskPage(data));
});
test('the native client only reads and binds paging, profile and task selection',async()=>{
  const old=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push({url,options});
    if(url.startsWith('/api/agent-history/tasks'))return response(taskPage());
    if(url.startsWith('/api/agent-history/sessions/'))return response(detail());
    return response(page());
  };
  try{
    await loadSessionPage();await loadSession(1);await loadTaskPage({task_id:2,status:'done'});
    assert.match(requests[0].url,/offset=0&limit=25&archive=all/);
    assert.match(requests[2].url,/task_id=2&status=done/);
    assert.ok(requests.every(r=>r.options.cache==='no-store'&&r.options.method===undefined));
    const count=requests.length;
    for(const options of [{agent_id:0},{archive:'invalid'},{offset:-1},{limit:101}])await assert.rejects(loadSessionPage(options));
    await assert.rejects(loadTaskPage({task_id:-2}));await assert.rejects(loadSession(0));assert.equal(requests.length,count);
  }finally{globalThis.fetch=old;}
});
test('source failures are distinct from an empty confirmed page',async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async()=>response(page({sessions:[],total:0}));assert.equal((await loadSessionPage()).total,0);
    globalThis.fetch=async()=>response({detail:'Quelle gesperrt'},503);await assert.rejects(loadSessionPage(),/503/);
    globalThis.fetch=async()=>response({ok:true,sessions:[]});await assert.rejects(loadSessionPage(),/nicht bestätigt/);
    globalThis.fetch=async()=>response({sessions:[],count:0,error:'unavailable'});await assert.rejects(loadMemoryNotes(),/nicht verfügbar/);
  }finally{globalThis.fetch=old;}
});
test('empty pages after concurrent deletions remain valid metadata',()=>{
  const data=page({sessions:[],total:1,offset:25});
  assert.equal(validateSessionPage(data,{offset:25}),data);
});
test('DOM viewer uses text nodes, suppresses old detail responses and links native tasks',()=>{
  const script=readFileSync(new URL('../src/scripts/agent-history.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(script,/innerHTML|insertAdjacentHTML|method:\s*['"]POST/);
  assert.match(script,/request!==detailEpoch/);assert.match(script,/request!==epoch/);
  assert.match(script,/\/tasks\?task=/);
  const astro=readFileSync(new URL('../src/pages/agenten/sessions.astro',import.meta.url),'utf8');
  assert.doesNotMatch(astro,/CoT-Zwischenspeicher|Konfabulation|Live-Telemetrie/);
  assert.match(astro,/Taskereignisse/);assert.match(astro,/Speicherstand/);
});
