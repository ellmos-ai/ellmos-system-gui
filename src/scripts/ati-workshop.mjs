const root = document.querySelector("[data-ati-workshop]");
if (root) {
  const one = selector => root.querySelector(selector);
  const all = selector => [...root.querySelectorAll(selector)];
  const panel = one("[data-ati-panel]");
  const opener = one("[data-ati-open]");
  const message = one("[data-ati-message]");
  const state = {tab: "overview", opened: false, mutationBusy: false};
  const mutationControlSelector = [
    "[data-ati-create] button[type=submit]",
    "[data-ati-edit-form] button[type=submit]",
    "[data-ati-transfer-form] button[type=submit]",
    "[data-ati-session-form] button[type=submit]",
    "[data-ati-cli-form] button[type=submit]",
    "[data-ati-action]",
    "[data-ati-run-scan]"
  ].join(",");

  function syncMutationControls() {
    for (const control of all(mutationControlSelector)) control.disabled = state.mutationBusy;
  }

  function beginMutation() {
    if (state.mutationBusy) return null;
    state.mutationBusy = true;
    root.setAttribute("aria-busy", "true");
    syncMutationControls();
    return () => {
      state.mutationBusy = false;
      root.removeAttribute("aria-busy");
      syncMutationControls();
    };
  }

  function setMessage(text, error = false, target = message) {
    target.textContent = text;
    target.dataset.error = error ? "true" : "false";
  }

  function empty(container, text) {
    container.replaceChildren();
    const item = document.createElement("p");
    item.className = "ati-empty";
    item.textContent = text;
    container.append(item);
  }

  function actionButton(label, action, id) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ati-button";
    button.dataset.atiAction = action;
    button.dataset.taskId = String(id);
    button.textContent = label;
    return button;
  }

  function renderTasks(container, tasks, emptyText) {
    container.replaceChildren();
    if (!Array.isArray(tasks) || tasks.length === 0) {
      empty(container, emptyText);
      return;
    }
    for (const task of tasks) {
      const card = document.createElement("article");
      card.className = "ati-task";
      const title = document.createElement("h4");
      title.textContent = task.task_text || "Aufgabe ohne Beschreibung";
      card.append(title);
      const meta = document.createElement("p");
      meta.className = "ati-meta";
      const parts = [task.tool_name || "Allgemein", task.status || "Status unbekannt"];
      if (task.priority_score !== undefined && task.priority_score !== null) parts.push("Priorität " + task.priority_score);
      meta.textContent = parts.join(" · ");
      card.append(meta);
      const actions = document.createElement("div");
      actions.className = "ati-task-actions";
      actions.append(actionButton("Bearbeiten", "edit", task.id), actionButton("Übertragen", "transfer", task.id), actionButton("Löschen", "delete", task.id));
      card.append(actions);
      container.append(card);
    }
  }

  function renderTools(container, tools, emptyText) {
    container.replaceChildren();
    if (!Array.isArray(tools) || tools.length === 0) {
      empty(container, emptyText);
      return;
    }
    for (const tool of tools) {
      const card = document.createElement("article");
      card.className = "ati-tool";
      const name = document.createElement("strong");
      name.textContent = tool.name || "Tool ohne Namen";
      card.append(name);
      const info = document.createElement("p");
      const parts = [];
      if (tool.path) parts.push(tool.path);
      if (tool.task_count !== undefined && tool.task_count !== null) parts.push(tool.task_count + " Aufgaben");
      info.textContent = parts.length ? parts.join(" · ") : "Keine zusätzlichen Angaben";
      card.append(info);
      container.append(card);
    }
  }

  function renderSessions(container, sessions, emptyText) {
    container.replaceChildren();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      empty(container, emptyText);
      return;
    }
    for (const session of sessions) {
      const card = document.createElement("article");
      card.className = "ati-session";
      const title = document.createElement("strong");
      title.textContent = session.partner_id || "System";
      card.append(title);
      const summary = document.createElement("p");
      summary.textContent = session.summary || "Keine Zusammenfassung vorhanden.";
      card.append(summary);
      const date = document.createElement("p");
      date.className = "ati-meta";
      const parsed = session.started_at ? new Date(session.started_at) : null;
      date.textContent = parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toLocaleString("de-DE")
        : (session.started_at || "Startzeit unbekannt");
      card.append(date);
      container.append(card);
    }
  }

  function displayError(container, error, label) {
    empty(container, label + ": " + error.message);
  }

  async function responseJson(response) {
    let data = {};
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) throw new Error("Die Backendantwort war kein gültiges JSON.");
      }
    }
    if (!response.ok) {
      const detail = data?.detail ?? data?.error;
      throw new Error(typeof detail === "string" ? detail : (detail ? JSON.stringify(detail) : "HTTP " + response.status));
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Die Backendantwort war kein JSON-Objekt.");
    }
    if (data?.success === false) throw new Error(data.error || data.message || "Der Backendadapter meldet einen Fehler.");
    return data;
  }

  function showResults(results, labels) {
    const failures = results.flatMap((result, index) => result.status === "rejected" ? [labels[index] + ": " + result.reason.message] : []);
    setMessage(failures.length ? "Einige Backenddaten sind nicht verfügbar. " + failures.join(" · ") : "Backenddaten wurden aktualisiert.");
  }

  async function loadOverview() {
    setMessage("ATI-Übersicht wird geladen.");
    const results = await Promise.allSettled([
      fetch("/api/ati/stats", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}).then(responseJson),
      fetch("/api/ati/tasks?limit=20", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}).then(responseJson),
      fetch("/api/scanner/tools", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}).then(responseJson),
      fetch("/api/ati/sessions", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}).then(responseJson)
    ]);
    const [stats, tasks, tools, sessions] = results;
    const statKeys = ["tools_scanned", "open_tasks", "sessions_today", "completed_today"];
    if (stats.status === "fulfilled" && stats.value && typeof stats.value === "object" && !Array.isArray(stats.value)) {
      const missingStats = statKeys.filter(key => !Object.prototype.hasOwnProperty.call(stats.value, key));
      for (const key of statKeys) one('[data-ati-stat="' + key + '"]').textContent = stats.value[key] ?? "Nicht gemeldet";
      if (missingStats.length) results[0] = {status: "rejected", reason: new Error("Statistikantwort ohne Felder: " + missingStats.join(", "))};
    } else {
      for (const key of statKeys) one('[data-ati-stat="' + key + '"]').textContent = "Nicht verfügbar";
      if (stats.status === "fulfilled") results[0] = {status: "rejected", reason: new Error("Ungültige Statistikantwort.")};
    }
    if (tasks.status === "fulfilled" && Array.isArray(tasks.value.tasks)) {
      const list = tasks.value.tasks;
      one("[data-ati-task-count]").textContent = String(list.length);
      renderTasks(one("[data-ati-task-list]"), list, "Keine offenen oder laufenden ATI-Aufgaben gemeldet.");
    } else {
      const error = tasks.status === "rejected" ? tasks.reason : new Error("ATI-Antwort enthält keine Aufgabenliste.");
      if (tasks.status === "fulfilled") results[1] = {status: "rejected", reason: error};
      one("[data-ati-task-count]").textContent = "–";
      displayError(one("[data-ati-task-list]"), error, "ATI-Aufgaben nicht verfügbar");
    }
    if (tools.status === "fulfilled" && Array.isArray(tools.value.tools)) {
      const list = tools.value.tools;
      one("[data-ati-tool-count]").textContent = String(tools.value.count ?? list.length);
      renderTools(one("[data-ati-overview-tools]"), list, "Keine Tools gemeldet.");
    } else {
      const error = tools.status === "rejected" ? tools.reason : new Error("Scannerantwort enthält keine Toolliste.");
      if (tools.status === "fulfilled") results[2] = {status: "rejected", reason: error};
      one("[data-ati-tool-count]").textContent = "–";
      displayError(one("[data-ati-overview-tools]"), error, "Toolübersicht nicht verfügbar");
    }
    if (sessions.status === "fulfilled" && Array.isArray(sessions.value.sessions)) {
      renderSessions(one("[data-ati-overview-sessions]"), sessions.value.sessions, "Noch keine Sitzungen gemeldet.");
    } else {
      const error = sessions.status === "rejected" ? sessions.reason : new Error("Sitzungsantwort enthält keine Liste.");
      if (sessions.status === "fulfilled") results[3] = {status: "rejected", reason: error};
      displayError(one("[data-ati-overview-sessions]"), error, "Sitzungen nicht verfügbar");
    }
    showResults(results, ["Statistik", "Aufgaben", "Tools", "Sitzungen"]);
  }

  async function loadScanner() {
    setMessage("Scannerübersicht wird geladen.");
    const results = await Promise.allSettled([
      fetch("/api/scanner/status", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}).then(responseJson),
      fetch("/api/scanner/tools", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}).then(responseJson),
      fetch("/api/scanned-tasks?limit=50", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}).then(responseJson)
    ]);
    const [status, tools, scanned] = results;
    const statusNode = one("[data-ati-scanner-status]");
    if (status.status === "fulfilled" && status.value && Object.prototype.hasOwnProperty.call(status.value, "last_run") &&
        Object.prototype.hasOwnProperty.call(status.value, "total_tools") && Object.prototype.hasOwnProperty.call(status.value, "total_tasks")) {
      const run = status.value.last_run;
      const when = run === null ? "Kein letzter Lauf gemeldet" : (run?.started_at || "Startzeit nicht gemeldet");
      statusNode.textContent = when + " · " + status.value.total_tools + " Tools · " + status.value.total_tasks + " Aufgaben";
    } else {
      const error = status.status === "rejected" ? status.reason : new Error("Scannerantwort enthält nicht alle Statusfelder.");
      if (status.status === "fulfilled") results[0] = {status: "rejected", reason: error};
      statusNode.textContent = "Scannerstatus nicht verfügbar: " + error.message;
    }
    if (tools.status === "fulfilled" && Array.isArray(tools.value.tools)) {
      const list = tools.value.tools;
      one("[data-ati-scanner-tool-count]").textContent = String(tools.value.count ?? list.length);
      renderTools(one("[data-ati-scanner-tools]"), list, "Der Backendadapter meldet keine Tools.");
    } else {
      const error = tools.status === "rejected" ? tools.reason : new Error("Scannerantwort enthält keine Toolliste.");
      if (tools.status === "fulfilled") results[1] = {status: "rejected", reason: error};
      one("[data-ati-scanner-tool-count]").textContent = "–";
      displayError(one("[data-ati-scanner-tools]"), error, "Toolliste nicht verfügbar");
    }
    if (scanned.status === "fulfilled" && Array.isArray(scanned.value.tasks)) {
      const list = scanned.value.tasks;
      one("[data-ati-scanned-count]").textContent = String(scanned.value.count ?? list.length);
      renderTasks(one("[data-ati-scanned-tasks]"), list, "Keine gescannten ATI-Aufgaben gemeldet.");
    } else {
      const error = scanned.status === "rejected" ? scanned.reason : new Error("ATI-Antwort enthält keine gescannte Aufgabenliste.");
      if (scanned.status === "fulfilled") results[2] = {status: "rejected", reason: error};
      one("[data-ati-scanned-count]").textContent = "–";
      displayError(one("[data-ati-scanned-tasks]"), error, "Gescannte Aufgaben nicht verfügbar");
    }
    showResults(results, ["Scannerstatus", "Tools", "Gescannte Aufgaben"]);
  }

  async function loadSessions() {
    setMessage("Sitzungen werden geladen.");
    try {
      const data = await responseJson(await fetch("/api/ati/sessions", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}));
      if (!Array.isArray(data.sessions)) throw new Error("Sitzungsantwort enthält keine Liste.");
      renderSessions(one("[data-ati-sessions]"), data.sessions, "Noch keine Sitzungen gemeldet.");
      setMessage("Sitzungen wurden aktualisiert.");
    } catch (error) {
      displayError(one("[data-ati-sessions]"), error, "Sitzungshistorie nicht verfügbar");
      setMessage("Sitzungshistorie nicht verfügbar: " + error.message, true);
    }
  }

  async function loadOnboarding() {
    setMessage("Offene ATI-Aufgaben für das Onboarding werden geladen.");
    try {
      const data = await responseJson(await fetch("/api/ati/tasks?limit=20&status=offen", {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}));
      if (!Array.isArray(data.tasks)) throw new Error("ATI-Antwort enthält keine Aufgabenliste.");
      const tasks = data.tasks;
      const onboarding = tasks.filter(task => {
        const name = String(task.tool_name || "");
        const text = String(task.task_text || "").toLowerCase();
        return name === "Neues Tool" || name.includes("Discovery") || text.includes("onboarding") || text.includes("einrichten");
      });
      renderTasks(one("[data-ati-onboarding-list]"), onboarding, "Keine passenden offenen Onboarding-Aufgaben in der geladenen Liste.");
      setMessage("Onboarding-Ansicht wurde aus dem ATI-Aufgabenendpunkt aktualisiert.");
    } catch (error) {
      displayError(one("[data-ati-onboarding-list]"), error, "Onboarding-Daten nicht verfügbar");
      setMessage("Onboarding-Daten nicht verfügbar: " + error.message, true);
    }
  }

  async function loadCurrentView() {
    try {
      if (state.tab === "overview") await loadOverview();
      else if (state.tab === "scanner") await loadScanner();
      else if (state.tab === "sessions") await loadSessions();
      else await loadOnboarding();
    } finally {
      syncMutationControls();
    }
  }

  function activateTab(name) {
    state.tab = name;
    for (const tab of all("[data-ati-tab]")) {
      const active = tab.dataset.atiTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const view of all("[data-ati-view]")) {
      view.hidden = view.dataset.atiView !== name;
    }
    if (state.opened) void loadCurrentView();
  }

  async function loadTaskDetail(id) {
    const result = await responseJson(await fetch(`/api/ati/tasks/${encodeURIComponent(id)}`, {headers: {Accept: "application/json"}, cache: "no-store", redirect: "error"}));
    return result.task || result;
  }

  async function updateTask(id, payload) {
    return responseJson(await fetch(`/api/ati/tasks/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {Accept: "application/json", "Content-Type": "application/json"},
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error"
    }));
  }

  async function deleteTask(id) {
    return responseJson(await fetch(`/api/ati/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {Accept: "application/json"},
      cache: "no-store",
      redirect: "error"
    }));
  }

  function priorityFor(score) {
    const value = Number(score ?? 50);
    if (value > 70) return "P1";
    if (value > 40) return "P2";
    return "P3";
  }

  function transferPrompt(task) {
    return `[ATI-Aufgabenübergabe]

Werkzeug: ${task.tool_name || "Unbekannt"}
Aufwand: ${task.aufwand || "mittel"}
Ursprüngliche Priorität: ${task.priority_score ?? 50}

AUFGABE:
${task.task_text || ""}

---
Diese Aufgabe wurde vom ATI-System (Advanced Tool Integration) erkannt.
Bitte bearbeite sie mit entsprechender Sorgfalt.
Nach Abschluss: bach task done <ID>`;
  }

  function openEditDialog(task) {
    const form = one("[data-ati-edit-form]");
    form.elements.id.value = String(task.id);
    form.elements.task_text.value = task.task_text || "";
    form.elements.tool_name.value = task.tool_name || "";
    form.elements.aufwand.value = task.aufwand || "mittel";
    form.elements.priority_score.value = task.priority_score ?? 50;
    form.elements.status.value = task.status || "offen";
    setMessage("", false, one("[data-ati-edit-message]"));
    one("[data-ati-edit-dialog]").showModal();
    form.elements.task_text.focus();
  }

  async function editTask(id) {
    setMessage("ATI-Aufgabe wird gelesen.");
    const task = await loadTaskDetail(id);
    if (!task || task.id === undefined) throw new Error("Die Detailantwort enthält keine Aufgaben-ID.");
    openEditDialog(task);
    setMessage("Aufgabendetails wurden geladen.");
  }

  async function prepareTransfer(id) {
    setMessage("ATI-Aufgabe für die Übertragung wird gelesen.");
    const task = await loadTaskDetail(id);
    if (!task || task.id === undefined) throw new Error("Die Detailantwort enthält keine Aufgaben-ID.");
    const form = one("[data-ati-transfer-form]");
    form.elements.id.value = String(task.id);
    form.elements.title.value = String(task.task_text || "").slice(0, 100);
    form.elements.category.value = "ATI";
    form.elements.priority.value = priorityFor(task.priority_score);
    one("[data-ati-transfer-preview]").textContent = transferPrompt(task);
    setMessage("", false, one("[data-ati-transfer-message]"));
    one("[data-ati-transfer-dialog]").showModal();
    form.elements.title.focus();
  }

  async function handleTaskAction(event) {
    const button = event.target.closest("[data-ati-action]");
    if (!button || !root.contains(button) || state.mutationBusy) return;
    const id = button.dataset.taskId;
    try {
      if (button.dataset.atiAction === "edit") await editTask(id);
      if (button.dataset.atiAction === "transfer") await prepareTransfer(id);
      if (button.dataset.atiAction === "delete") {
        const finishMutation = beginMutation();
        if (!finishMutation) return;
        try {
          if (!window.confirm("ATI-Aufgabe wirklich löschen?")) return;
          await deleteTask(id);
          await loadCurrentView();
          setMessage("ATI-Aufgabe wurde gelöscht.");
        } finally {
          finishMutation();
        }
      }
    } catch (error) {
      setMessage("ATI-Aktion nicht verfügbar: " + error.message, true);
    }
  }

  async function createTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      task_text: String(values.get("task_text") || "").trim(),
      tool_name: String(values.get("tool_name") || "").trim() || "Manuell",
      aufwand: String(values.get("aufwand") || "mittel"),
      priority_score: Number(values.get("priority_score")),
      status: "offen"
    };
    if (!payload.task_text || !Number.isFinite(payload.priority_score)) return;
    const finishMutation = beginMutation();
    if (!finishMutation) return;
    try {
      setMessage("ATI-Aufgabe wird gespeichert.");
      await responseJson(await fetch("/api/ati/tasks", {
        method: "POST",
        headers: {Accept: "application/json", "Content-Type": "application/json"},
        body: JSON.stringify(payload),
        cache: "no-store",
        redirect: "error"
      }));
      form.reset();
      form.elements.priority_score.value = "50";
      form.elements.aufwand.value = "mittel";
      await loadCurrentView();
      setMessage("ATI-Aufgabe wurde im vorhandenen ATI-Bestand angelegt.");
    } catch (error) {
      setMessage("ATI-Aufgabe nicht verfügbar: " + error.message, true);
    } finally {
      finishMutation();
    }
  }

  async function saveTaskEdits(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const id = String(values.get("id") || "");
    const payload = {
      task_text: String(values.get("task_text") || "").trim(),
      tool_name: String(values.get("tool_name") || "").trim() || "Manuell",
      aufwand: String(values.get("aufwand") || "mittel"),
      priority_score: Number(values.get("priority_score")),
      status: String(values.get("status") || "offen")
    };
    if (!/^\d+$/.test(id) || !payload.task_text || !Number.isFinite(payload.priority_score)) return;
    const finishMutation = beginMutation();
    if (!finishMutation) return;
    try {
      setMessage("ATI-Aufgabe wird aktualisiert.", false, one("[data-ati-edit-message]"));
      await updateTask(id, payload);
      one("[data-ati-edit-dialog]").close();
      await loadCurrentView();
      setMessage("ATI-Aufgabe wurde aktualisiert.");
    } catch (error) {
      setMessage("Änderung nicht verfügbar: " + error.message, true, one("[data-ati-edit-message]"));
    } finally {
      finishMutation();
    }
  }

  async function executeTransfer(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const id = String(values.get("id") || "");
    if (!/^\d+$/.test(id)) return;
    const payload = {
      title: String(values.get("title") || "").trim(),
      priority: String(values.get("priority") || "P3"),
      project: String(values.get("category") || "ATI").trim() || "ATI",
      description: one("[data-ati-transfer-preview]").textContent,
      created_by: "ati",
      assigned_to: "user"
    };
    if (!payload.title) return;
    const finishMutation = beginMutation();
    if (!finishMutation) return;
    try {
      if (!window.confirm("Diese ATI-Aufgabe an den bestehenden BACH-Aufgabenendpunkt übertragen?")) return;
      setMessage("BACH-Aufgabe wird angelegt.", false, one("[data-ati-transfer-message]"));
      const created = await responseJson(await fetch("/api/tasks", {
        method: "POST",
        headers: {Accept: "application/json", "Content-Type": "application/json"},
        body: JSON.stringify(payload),
        cache: "no-store",
        redirect: "error"
      }));
      const newId = created.task_id ?? created.task?.id ?? created.id;
      try {
        await updateTask(id, {status: "transferiert"});
      } catch (error) {
        one("[data-ati-transfer-dialog]").close();
        await loadCurrentView();
        const reference = newId === undefined ? "" : " (BACH-ID " + newId + ")";
        setMessage("Die BACH-Aufgabe wurde angelegt" + reference + ", aber die ATI-Aufgabe konnte nicht als übertragen markiert werden. Prüfe die BACH-Aufgabe, bevor du erneut überträgst. " + error.message, true);
        return;
      }
      one("[data-ati-transfer-dialog]").close();
      await loadCurrentView();
      const reference = newId === undefined ? "" : " (BACH-ID " + newId + ")";
      setMessage("ATI-Aufgabe wurde übertragen" + reference + ".");
    } catch (error) {
      setMessage("Übertragung nicht verfügbar: " + error.message, true, one("[data-ati-transfer-message]"));
    } finally {
      finishMutation();
    }
  }

  async function runScanner() {
    const finishMutation = beginMutation();
    if (!finishMutation) return;
    try {
      if (!window.confirm("Den ATI-Scanner jetzt über den angebundenen Backendadapter starten?")) return;
      setMessage("Scanneranfrage wird gesendet.");
      const data = await responseJson(await fetch("/api/scanner/run", {
        method: "POST",
        headers: {Accept: "application/json"},
        cache: "no-store",
        redirect: "error"
      }));
      setMessage("Backendantwort zur Scanneranfrage: " + (data.message || data.status || "angenommen") + ". Ein abgeschlossener Scan ist dadurch nicht belegt.");
    } catch (error) {
      setMessage("Scanneradapter nicht verfügbar: " + error.message, true);
    } finally {
      finishMutation();
    }
  }

  async function startAtiSession(event) {
    event.preventDefault();
    const minutes = Number(new FormData(event.currentTarget).get("work_time"));
    if (!Number.isInteger(minutes) || minutes < 1) return;
    const finishMutation = beginMutation();
    if (!finishMutation) return;
    try {
      if (!window.confirm("ATI-Sitzung mit dem vorhandenen Backendadapter anfragen? Das kann Claude Desktop öffnen oder einen Prompt kopieren.")) return;
      setMessage("ATI-Sitzung wird angefragt.");
      const data = await responseJson(await fetch(`/api/ati/session/start?work_time=${encodeURIComponent(minutes)}`, {
        method: "POST",
        headers: {Accept: "application/json"},
        cache: "no-store",
        redirect: "error"
      }));
      const detail = [data.work_time ? data.work_time + " Min." : "", data.session_end || "", data.triggered === false ? "Prompt-Kopie gemeldet" : ""].filter(Boolean).join(" · ");
      setMessage("Backendantwort zur ATI-Sitzungsanfrage: " + (detail || "angenommen") + ".");
      await loadSessions();
    } catch (error) {
      setMessage("ATI-Sitzungsadapter nicht verfügbar: " + error.message, true);
    } finally {
      finishMutation();
    }
  }

  async function startCliSession(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const minutes = Number(values.get("work_time"));
    const prompt = String(values.get("task_prompt") || "");
    if (!Number.isInteger(minutes) || minutes < 1) return;
    const finishMutation = beginMutation();
    if (!finishMutation) return;
    try {
      const params = new URLSearchParams({work_time: String(minutes)});
      if (prompt) params.set("task_prompt", prompt);
      if (!window.confirm("Claude-Code-Sitzung über den vorhandenen Backendadapter anfragen?")) return;
      setMessage("Claude-Code-Sitzung wird angefragt.");
      const data = await responseJson(await fetch(`/api/ati/session/start-cli?${params.toString()}`, {
        method: "POST",
        headers: {Accept: "application/json"},
        cache: "no-store",
        redirect: "error"
      }));
      setMessage("Backendantwort zur Terminalstart-Anfrage: " + (data.hint || data.message || "angenommen") + ". Ein sichtbares Fenster wird hier nicht verifiziert.");
      await loadSessions();
    } catch (error) {
      setMessage("Claude-Code-Adapter nicht verfügbar: " + error.message, true);
    } finally {
      finishMutation();
    }
  }

  opener.addEventListener("click", () => {
    state.opened = !state.opened;
    panel.hidden = !state.opened;
    opener.setAttribute("aria-expanded", String(state.opened));
    opener.textContent = state.opened ? "ATI-Werkstatt schließen" : "ATI-Werkstatt öffnen";
    if (state.opened) void loadCurrentView();
  });
  for (const tab of all("[data-ati-tab]")) {
    tab.addEventListener("click", () => activateTab(tab.dataset.atiTab));
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const tabs = all("[data-ati-tab]");
      const index = tabs.indexOf(tab);
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      activateTab(next.dataset.atiTab);
    });
  }
  one("[data-ati-refresh]").addEventListener("click", () => { if (state.opened) void loadCurrentView(); });
  one("[data-ati-task-list]").addEventListener("click", handleTaskAction);
  one("[data-ati-scanned-tasks]").addEventListener("click", handleTaskAction);
  one("[data-ati-onboarding-list]").addEventListener("click", handleTaskAction);
  one("[data-ati-create]").addEventListener("submit", createTask);
  one("[data-ati-edit-form]").addEventListener("submit", saveTaskEdits);
  one("[data-ati-transfer-form]").addEventListener("submit", executeTransfer);
  one("[data-ati-session-form]").addEventListener("submit", startAtiSession);
  one("[data-ati-cli-form]").addEventListener("submit", startCliSession);
  one("[data-ati-run-scan]").addEventListener("click", () => { void runScanner(); });
  for (const close of all("[data-ati-close]")) {
    close.addEventListener("click", () => {
      const dialog = close.dataset.atiClose === "edit" ? one("[data-ati-edit-dialog]") : one("[data-ati-transfer-dialog]");
      dialog.close();
    });
  }
}
