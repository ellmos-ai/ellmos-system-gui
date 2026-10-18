// Template assembly belongs to Living & Running; never starts a provider implicitly.
const $ = id => document.getElementById(id);
let state = null, modelRevision = 0, mutationPending = false, pendingStart = null;
const allowed = ["backend","model","mode","think","avatar","symbol","include_system_prompt","custom_system_prompt","pause_after","pause_minutes","pause_basis"];
async function api(path, options = {}) {
 const response = await fetch(path, options);
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Anfrage fehlgeschlagen (HTTP " + response.status + ").");
 return data;
}
function notify(text) { $("template-agent-status").textContent = text; }
function clearPendingStart() {
 pendingStart = null;
 const button = $("template-agent-start");
 button.hidden = true;
 button.disabled = true;
 button.textContent = "Starten";
}
function draw() {
 if (mutationPending) return;
 const bp = state.blueprints.find(row => row.id === Number($("template-agent-blueprint").value));
 if (!bp) { $("template-agent-save").disabled = true; return; }
 if (pendingStart && (pendingStart.blueprintId !== bp.id || pendingStart.version !== bp.version)) clearPendingStart();
 state.selected = bp;
 const existing = state.core.agents.find(slot => slot.blueprint_id === bp.id);
 const config = {...(bp.contractus?.execution || {}), ...(existing || {})};
 const hasDefinitionPin = bp.definition_ref?.blueprint_id === bp.id
  && bp.definition_ref?.version === bp.version && /^[a-f0-9]{64}$/.test(bp.definition_ref?.sha256 || "");
 state.execution = Object.fromEntries(allowed.filter(key => key in config).map(key => [key,config[key]]));
 const providers = state.core.supported_backend_ids || [];
 $("template-agent-backend").replaceChildren(new Option("Anbieter auswählen",""), ...providers.map(name => new Option(name,name)));
 $("template-agent-backend").value = providers.includes(config.backend) ? config.backend : "";
 $("template-agent-model").value = config.model || "";
 $("template-agent-mode").value = config.mode === "full" ? "full" : "safe";
 $("template-agent-summary").textContent = [bp.description || "", "Rolle: " + (bp.persona_role || "Eigene Rolle"), "Skills: " + (bp.skills || []).join(", "), "Werkzeuge: " + (bp.governance?.tool_whitelist || []).join(", ")].join("\n");
 $("template-agent-prompt").textContent = bp.persona_prompt || "";
 const blocked = existing && (existing.runtime_verified !== true || existing.running !== false || existing.execution && existing.execution.terminal !== true);
 $("template-agent-save").disabled = !!blocked || !hasDefinitionPin || !String(bp.persona_prompt || "").trim() || !["casualis","usus"].includes(bp.modus);
 $("template-agent-save").textContent = existing ? "Agent aktualisieren" : "Als Agent übernehmen";
 notify(blocked ? "Diese Vorlage hat einen laufenden oder nicht bestätigten Agenten. Erst den Lauf beenden und die Auswahl aktualisieren." :
  !hasDefinitionPin ? "Unveränderliche Vorlagenfassung konnte nicht bestätigt werden." :
  existing ? "Für diese Vorlage besteht bereits ein Agent. Die Übernahme aktualisiert ihn; sie startet keinen Lauf." : "Rolle, Skills und Toolfreigaben werden aus der Vorlage übernommen. Ein Start erfolgt separat.");
 models().catch(error => notify(error.message));
}
async function models() {
 const generation = ++modelRevision, backend = $("template-agent-backend").value;
 $("template-agent-models").replaceChildren();
 if (!backend) return;
 const data = await api("/api/system/workers/models?backend=" + encodeURIComponent(backend));
 if (generation !== modelRevision || backend !== $("template-agent-backend").value) return;
 if (!Array.isArray(data.models)) throw new Error("Modellauswahl nicht verfügbar.");
 $("template-agent-models").replaceChildren(...data.models.filter(name => typeof name === "string").map(name => new Option(name,name)));
}
export async function openTemplatePicker() {
 if (mutationPending) return;
 const dialog = $("template-agent-picker");
 dialog.showModal(); notify("Lade Vorlagen und aktuelle Agentenkonfiguration …"); $("template-agent-save").disabled = true;
 clearPendingStart();
 const request = {};
 state = request;
 try {
  const [catalogue,core] = await Promise.all([api("/api/agent-studio/blueprints"),api("/api/system/core-agents")]);
  if (state !== request || !dialog.open) return;
  if (!Array.isArray(core.agents) || !/^[a-f0-9]{64}$/.test(core.configuration_version || "") || !Array.isArray(core.supported_backend_ids)) throw new Error("Aktuelle Agentenkonfiguration nicht bestätigt.");
  const blueprints = [...(catalogue.templates || []),...(catalogue.blueprints || [])].filter(bp => ["agent","role"].includes(bp.kind));
  if (blueprints.some(bp => !Number.isSafeInteger(bp.id) || !Number.isSafeInteger(bp.version))) throw new Error("Vorlagenkatalog ungültig.");
  Object.assign(request,{blueprints,core});
  $("template-agent-blueprint").replaceChildren(...blueprints.map(bp => new Option((bp.is_template ? "Vorlage: " : "Blueprint: ") + (bp.title || bp.name),String(bp.id))));
  if (!blueprints.length) { notify("Keine ausführbaren Agentenvorlagen vorhanden. Vorlagen können in der Agenten-Werkstatt erstellt werden."); return; }
  draw();
 } catch(error) { if (state === request) notify(error.message); }
}
$("template-agent-blueprint").addEventListener("change",() => { clearPendingStart(); draw(); });
$("template-agent-backend").addEventListener("change",() => {
 $("template-agent-model").value = ""; models().catch(error => notify(error.message));
});
$("template-agent-form").addEventListener("submit",async event => {
 event.preventDefault();
 if (mutationPending || !state?.selected || $("template-agent-save").disabled || !event.target.reportValidity()) return;
 const current = state, bp = current.selected, button = $("template-agent-save");
 clearPendingStart();
 const execution = {...current.execution,backend:$("template-agent-backend").value,model:$("template-agent-model").value.trim(),mode:$("template-agent-mode").value};
 if (!execution.backend || !execution.model) { notify("Anbieter und konkretes Modell auswählen."); return; }
 mutationPending = true;
 const controls = [...event.target.querySelectorAll('input,select,button')].map(node => ({node,disabled:node.disabled}));
 for (const control of controls) control.node.disabled = true;
 button.disabled = true;
 try {
  const result = await api("/api/agent-studio/blueprints/" + bp.id + "/materialize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_version:bp.version,configuration_version:current.core.configuration_version,execution})});
  if (state !== current) return;
  if (result.success !== true || result.worker_started !== false || result.id !== bp.id || result.slot_id !== "system-blueprint-" + bp.id) throw new Error("Übernahme nicht bestätigt. Vor einem weiteren Versuch den Agentenstatus prüfen.");
  const readback = await api("/api/system/core-agents");
  if (state !== current) return;
  const actual = readback.agents?.find(slot => slot.id === result.slot_id);
  if (!actual || actual.backend !== execution.backend || actual.model !== execution.model
      || actual.blueprint_version !== bp.version
      || result.configuration_version !== readback.configuration_version
      || result.definition_ref?.sha256 !== bp.definition_ref?.sha256
      || actual.definition_ref?.sha256 !== result.definition_ref?.sha256
      || result.definition_ref?.version !== bp.version) throw new Error("Gespeicherte Agentenkonfiguration konnte nicht bestätigt werden.");
  current.core = readback;
  pendingStart = {blueprintId:bp.id,version:bp.version,
    configurationVersion:result.configuration_version,definitionRef:result.definition_ref};
  $("template-agent-start").hidden = false;
  window.loadCoreSlots?.();
  window.loadBackgroundWorkers?.();
  notify(`Agent übernommen · Living bereit. Vorlage #${bp.version} ist mit ${result.definition_ref.sha256} gepinnt. Der Start bleibt eine eigene Aktion.`);
 } catch(error) {
  // Keep the draft, but require a fresh catalogue after any ambiguous or failed mutation.
  if (state === current) notify(error.message + " Auswahl neu laden, bevor erneut gespeichert wird.");
 } finally {
  mutationPending = false;
  for (const control of controls) control.node.disabled = control.disabled;
  if (state === current) button.disabled = true;
 }
});
$("template-agent-start").addEventListener("click",async () => {
 if (mutationPending || !state?.selected || !pendingStart) return;
 const pin = pendingStart, button = $("template-agent-start");
 if (state.selected.id !== pin.blueprintId || state.selected.version !== pin.version
     || state.core.configuration_version !== pin.configurationVersion) {
  clearPendingStart(); notify("Auswahl oder Konfiguration hat sich geändert. Vorlage und Status neu laden."); return;
 }
 mutationPending = true; button.disabled = true;
 const requestId = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
 let started = false, refreshAfterFailure = false, failureMessage = "";
 try {
  if (!/^[a-f0-9]{32}$/.test(requestId || "")) throw new Error("Sichere Start-Request-ID nicht verfügbar.");
  const result = await api(`/api/agent-studio/blueprints/${pin.blueprintId}/start`,{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({expected_version:pin.version,configuration_version:pin.configurationVersion,start_request_id:requestId})
  });
  const receipt = result.execution;
  if (result.success !== true || result.start_cause !== "manual"
      || result.definition_ref?.sha256 !== pin.definitionRef.sha256
      || result.configuration_version !== pin.configurationVersion
      || result.run_id !== receipt?.generation
      || !/^[a-f0-9]{32}$/.test(result.run_id || "")
      || receipt?.schema !== "bach.worker-execution.v1"
      || receipt.worker_id !== `system-blueprint-${pin.blueprintId}`
      || receipt.start_request_id !== requestId
      || receipt.configuration_ref?.sha256 !== pin.configurationVersion
      || receipt.worker_thread_started !== true) throw new Error("Expliziter Start konnte nicht eindeutig dem gepinnten Lauf zugeordnet werden.");
  notify(`Manuell gestartet · Lauf-ID ${result.run_id} · Vorlage #${pin.version} · Konfiguration ${pin.configurationVersion}.`);
  button.textContent = "Lauf bestätigt";
  pendingStart = null;
  started = true;
  window.loadCoreSlots?.(); window.loadBackgroundWorkers?.();
 } catch(error) {
  clearPendingStart();
  failureMessage = error.message + " Status wird neu geladen; bestätige die Vorlage erneut, bevor du wieder startest.";
  notify(failureMessage);
  refreshAfterFailure = true;
 }
 finally {
  mutationPending = false; button.disabled = started;
  if (refreshAfterFailure && state) {
   $("template-agent-picker").close();
   await openTemplatePicker();
   notify(failureMessage);
  }
 }
});
$("template-agent-refresh").addEventListener("click",() => {
 if (mutationPending) return;
 $("template-agent-picker").close();openTemplatePicker();
});
window.BachTemplatePicker = {open:openTemplatePicker};

$("template-agent-picker").addEventListener("cancel",event => { if (mutationPending) event.preventDefault(); });
