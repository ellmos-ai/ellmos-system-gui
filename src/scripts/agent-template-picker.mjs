// Template assembly belongs to Living & Running; never starts a provider implicitly.
const $ = id => document.getElementById(id);
let state = null, modelRevision = 0;
const allowed = ["backend","model","mode","think","avatar","symbol","include_system_prompt","custom_system_prompt","pause_after","pause_minutes","pause_basis"];
async function api(path, options = {}) {
 const response = await fetch(path, options);
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Anfrage fehlgeschlagen (HTTP " + response.status + ").");
 return data;
}
function notify(text) { $("template-agent-status").textContent = text; }
function draw() {
 const bp = state.blueprints.find(row => row.id === Number($("template-agent-blueprint").value));
 if (!bp) { $("template-agent-save").disabled = true; return; }
 state.selected = bp;
 const existing = state.core.agents.find(slot => slot.blueprint_id === bp.id);
 const config = {...(bp.contractus?.execution || {}), ...(existing || {})};
 state.execution = Object.fromEntries(allowed.filter(key => key in config).map(key => [key,config[key]]));
 const providers = state.core.supported_backend_ids || [];
 $("template-agent-backend").replaceChildren(new Option("Anbieter auswählen",""), ...providers.map(name => new Option(name,name)));
 $("template-agent-backend").value = providers.includes(config.backend) ? config.backend : "";
 $("template-agent-model").value = config.model || "";
 $("template-agent-mode").value = config.mode === "full" ? "full" : "safe";
 $("template-agent-summary").textContent = [bp.description || "", "Rolle: " + (bp.persona_role || "Eigene Rolle"), "Skills: " + (bp.skills || []).join(", "), "Werkzeuge: " + (bp.governance?.tool_whitelist || []).join(", ")].join("\n");
 $("template-agent-prompt").textContent = bp.persona_prompt || "";
 const blocked = existing && (existing.runtime_verified !== true || existing.running !== false || existing.execution && existing.execution.terminal !== true);
 $("template-agent-save").disabled = !!blocked || !String(bp.persona_prompt || "").trim() || !["casualis","usus"].includes(bp.modus);
 $("template-agent-save").textContent = existing ? "Agent aktualisieren" : "Als Agent übernehmen";
 notify(blocked ? "Diese Vorlage hat einen laufenden oder nicht bestätigten Agenten. Erst den Lauf beenden und die Auswahl aktualisieren." :
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
 const dialog = $("template-agent-picker");
 dialog.showModal(); notify("Lade Vorlagen und aktuelle Agentenkonfiguration …"); $("template-agent-save").disabled = true;
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
$("template-agent-blueprint").addEventListener("change",draw);
$("template-agent-backend").addEventListener("change",() => {
 $("template-agent-model").value = ""; models().catch(error => notify(error.message));
});
$("template-agent-form").addEventListener("submit",async event => {
 event.preventDefault();
 if (!state?.selected || $("template-agent-save").disabled || !event.target.reportValidity()) return;
 const current = state, bp = current.selected, button = $("template-agent-save");
 const execution = {...current.execution,backend:$("template-agent-backend").value,model:$("template-agent-model").value.trim(),mode:$("template-agent-mode").value};
 if (!execution.backend || !execution.model) { notify("Anbieter und konkretes Modell auswählen."); return; }
 button.disabled = true;
 try {
  const result = await api("/api/agent-studio/blueprints/" + bp.id + "/materialize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_version:bp.version,configuration_version:current.core.configuration_version,execution})});
  if (result.success !== true || result.worker_started !== false || result.id !== bp.id || result.slot_id !== "system-blueprint-" + bp.id) throw new Error("Übernahme nicht bestätigt. Vor einem weiteren Versuch den Agentenstatus prüfen.");
  const readback = await api("/api/system/core-agents");
  const actual = readback.agents?.find(slot => slot.id === result.slot_id);
  if (!actual || actual.backend !== execution.backend || actual.model !== execution.model || actual.blueprint_version !== bp.version) throw new Error("Gespeicherte Agentenkonfiguration konnte nicht bestätigt werden.");
  $("template-agent-picker").close(); state = null;
  window.loadCoreSlots?.();
  window.loadBackgroundWorkers?.();
  const note = document.getElementById("worker-status-summary");
  if (note) note.textContent = actual.runtime_verified === true && actual.living === true ? "Agent übernommen · Living bereit. Den Start ausdrücklich am Agenten auslösen." : "Agent übernommen · Laufzeitstatus wird geprüft.";
 } catch(error) {
  // Keep the draft, but require a fresh catalogue after any ambiguous or failed mutation.
  notify(error.message + " Auswahl neu laden, bevor erneut gespeichert wird.");
 } finally {
  if (state === current) button.disabled = true;
 }
});
$("template-agent-refresh").addEventListener("click",() => {
 $("template-agent-picker").close();openTemplatePicker();
});
window.BachTemplatePicker = {open:openTemplatePicker};
