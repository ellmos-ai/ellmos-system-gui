import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {escapeHtml,blueprintState,executionSettings,normalizeTools,correlatedStart,instanceSettings,startLabel,modelBindingMatches,promptMutationPayload} from "../src/scripts/blueprint-studio.mjs";

test("catalogue escapes saved names and prompts",()=>{
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'),"&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml("Müller & Söhne"),"Müller &amp; Söhne");
});
test("a stored flag cannot claim Living or Running",()=>{
  assert.equal(blueprintState({is_materialized:1}),"Vorlage");
  assert.equal(blueprintState({instance:{status:"running",running:true}}),"Konfiguriert · Status unbekannt");
});
test("only observed controller state supplies readiness",()=>{
  assert.equal(blueprintState({instance:{runtime_verified:true,running:true}}),"Running");
  assert.equal(blueprintState({instance:{runtime_verified:true,running:false,living:true}}),"Living · bereit");
  assert.equal(blueprintState({instance:{runtime_verified:true,running:false,enabled:false}}),"Aus");
});
test("execution uses saved configuration and observed instance without model fallback",()=>{
  assert.deepEqual(executionSettings({}),{});
  assert.equal(executionSettings({contractus:{execution:{model:"openrouter/free"}},instance:{model:"current-model"}},{model:"default"}).model,"current-model");
});
test("legacy grants map to native tools; unknown grants stay visible",()=>{
  assert.deepEqual(normalizeTools(["read_files","directory_list","mcp_cookbooks"]),["read_file","list_directory","mcp_cookbooks"]);
});
test("start confirmation binds worker, request, service and generation",()=>{
  const result={runtime_verified:true,execution:{schema:"bach.worker-execution.v1",worker_id:"system-blueprint-7",start_request_id:"a".repeat(32),service_instance:"b".repeat(32),generation:"c".repeat(32),terminal:false,worker_thread_started:true}};
  assert.equal(correlatedStart(result,"system-blueprint-7","a".repeat(32)),true);
  assert.equal(correlatedStart(result,"another-worker","a".repeat(32)),false);
  assert.equal(correlatedStart(result,"system-blueprint-7","d".repeat(32)),false);
  assert.equal(correlatedStart({...result,execution:{...result.execution,generation:""}},"system-blueprint-7","a".repeat(32)),false);
  assert.equal(correlatedStart({...result,execution:{...result.execution,worker_thread_started:"true"}},"system-blueprint-7","a".repeat(32)),false);
});

test("instance edits use values and CAS from the same fresh core image",()=>{
  const stale={id:7,contractus:{execution:{model:"saved-model",mode:"safe"}},instance:{model:"stale-model",backend:"ollama",mode:"safe"}};
  const core={configuration_version:"fresh",agents:[{id:"buddha_chat",model:"default-model"},{id:"system-blueprint-7",blueprint_id:7,model:"fresh-model",backend:"openrouter",mode:"full"}]};
  assert.equal(instanceSettings(stale,core).model,"fresh-model");
  assert.equal(instanceSettings(stale,core).mode,"full");
  assert.equal(instanceSettings(stale,core).backend,"openrouter");
});
test("instance setup never inherits the unrelated chat fallback chain",()=>{
  const defaults=[{backend:"ollama",model:"chat-fallback"}];
  const own=[{backend:"codex",model:"own-fallback"}];
  const core={agents:[{id:"buddha_chat",backend:"ollama",model:"default",model_fallbacks:defaults}]};
  assert.equal(Object.hasOwn(instanceSettings({id:7},core),"model_fallbacks"),false);
  assert.deepEqual(instanceSettings({id:7,contractus:{execution:{model_fallbacks:own}}},core).model_fallbacks,own);
  const existing={agents:[...core.agents,{id:"system-blueprint-7",blueprint_id:7,model_fallbacks:[]}]};
  assert.deepEqual(instanceSettings({id:7,contractus:{execution:{model_fallbacks:own}}},existing).model_fallbacks,[]);
});
test("cloud and API paths never advertise a local start",()=>{
  assert.equal(startLabel({backend:"hermes",model:"any"}),"Cloud/API starten");
  assert.equal(startLabel({backend:"ollama",model:"model:cloud",resolved_model:"resolved"}),"Cloud/API starten");
  assert.equal(startLabel({backend:"ollama",model:"model:local",resolved_model:"model:cloud"}),"Cloud/API starten");
  assert.equal(startLabel({backend:"ollama",model:"test-local"}),"Lokal starten");
});
test("a made-up run_generation field cannot confirm the controller contract",()=>{
  const execution={schema:"bach.worker-execution.v1",worker_id:"system-blueprint-7",start_request_id:"a".repeat(32),service_instance:"b".repeat(32),run_generation:"c".repeat(32),terminal:false,worker_thread_started:true};
  assert.equal(correlatedStart({runtime_verified:true,execution},"system-blueprint-7","a".repeat(32)),false);
});


test("model readback checks the ordered fallback chain of the saved template",()=>{
  const model_fallbacks=[{backend:"ollama",model:"local-fallback"},{backend:"openrouter",model:"other-model"}];
  const sent={backend:"ollama",model:"primary",model_fallbacks};
  const saved=execution=>({...execution});
  assert.equal(modelBindingMatches(saved({...sent}),sent),true);
  assert.equal(modelBindingMatches(saved({...sent,model_fallbacks:[...model_fallbacks].reverse()}),sent),false);
  assert.equal(modelBindingMatches(saved({...sent,model_fallbacks:[]}),sent),false);
  assert.equal(modelBindingMatches(saved({...sent,model:"different"}),sent),false);
  const withoutFallbacks={backend:"ollama",model:"primary"};
  assert.equal(modelBindingMatches(saved({...withoutFallbacks}),withoutFallbacks),true);
  assert.equal(modelBindingMatches(saved(sent),withoutFallbacks),false);
  assert.equal(modelBindingMatches(saved(withoutFallbacks),{...withoutFallbacks,model_fallbacks:[]}),false);
});

test("core-prompt reset payload omits text field (required by BACH API 400 guard)",()=>{
  assert.deepEqual(promptMutationPayload("v1","Bearbeiteter Text",false),{configuration_version:"v1",text:"Bearbeiteter Text"});
  assert.deepEqual(promptMutationPayload("v1","Bearbeiteter Text",true),{configuration_version:"v1"});
  assert.equal(Object.hasOwn(promptMutationPayload("v1","x",true),"text"),false);
});

test("system prompt editor trigger is visible and reachable from blueprints, chat, and running",()=>{
  const bp = fs.readFileSync(new URL("../src/pages/agenten/blueprints.astro", import.meta.url), "utf8");
  assert.match(bp, /id="studio-prompts"/);
  assert.doesNotMatch(bp, /id="studio-prompts"[^>]*\bhidden\b/);
  const chat = fs.readFileSync(new URL("../src/pages/chat.astro", import.meta.url), "utf8");
  assert.match(chat, /\/agenten\/blueprints\?restore=prompts/);
  const running = fs.readFileSync(new URL("../src/pages/agenten/running.astro", import.meta.url), "utf8");
  assert.match(running, /\/agenten\/blueprints\?restore=prompts/);
});
