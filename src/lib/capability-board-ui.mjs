import {INVENTORIES, SKILL_ID, loadSkill, saveSkill, requestJson, confirmSkillReplacement, describeSourceError} from './capability-board-client.mjs';
import {createSymbol,mountSymbolPicker,withSkillSymbol} from './ticket-symbol.mjs';

import {catalogMatches, publicationLabel, safePublicationUrl} from './software-catalog.mjs';
import {plugCableElement} from './plugin-plug-ui.mjs';
import {plugSummaryText} from './plugin-plug-state.mjs';

const board = document.getElementById('capability-board');
if (board) {
  const kind = board.dataset.board;
  const symbolUrls=JSON.parse(board.dataset.ticketSymbols);
  const byId = id => document.getElementById(id);
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const button = (title, action, className = 'btn') => {
    const element = node('button', title, className);
    element.type = 'button'; element.addEventListener('click', action);
    return element;
  };
  const badge = text => node('span', text, 'badge');
  const flag = value => value === true ? 'Aktivierung eingestellt' : value === false ? 'Deaktivierung eingestellt' : 'Aktivierung nicht erfasst';
  const PAGE_SIZE = 40;
  let items = [], inventoryGeneration = 0, fetchedAt = new Date(), currentPage = 1;
  let selectedLocale = '';
  let activeLocale = '';
  try { selectedLocale = window.sessionStorage.getItem('bach.skills.locale') || ''; } catch {}

  function withLocale(url, locale) {
    if (kind !== 'skills' || !locale) return url;
    return url + (url.includes('?') ? '&' : '?') + 'locale=' + encodeURIComponent(locale);
  }

  function requestedLocale() { return activeLocale || selectedLocale || 'de'; }

  function renderItems() {
    const query = byId('board-search').value.trim().toLocaleLowerCase('de');
    const category = byId('board-category')?.value || '';
    const visible = items.filter(item => (!category || item.category === category)
      && [item.name, item.id, item.description, item.consumer].some(value => typeof value === 'string' && value.toLocaleLowerCase('de').includes(query)));
    const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), pageCount);
    const pageItems = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    byId('board-items').replaceChildren();
    byId('board-count').textContent = visible.length + ' / ' + items.length + ' Einträge';
    const pagination = byId('board-pagination');
    pagination.hidden = pageCount <= 1;
    byId('board-page').textContent = 'Seite ' + currentPage + ' / ' + pageCount;
    byId('board-prev').disabled = currentPage <= 1;
    byId('board-next').disabled = currentPage >= pageCount;
    for (const item of pageItems) {
      const card = node('article', null, 'capability-card');
      card.dataset.id = item.id;
      const title=node('h3',item.name||item.id);title.prepend(createSymbol(document,item.symbol,symbolUrls,
        {skills:'wissen',plugins:'topics_ai',mcp:'scripts',software:'topics_software',ocean:'topics_ai'}[kind]));
      card.append(title, node('p', item.missing_locale
        ? 'Keine Sprachfassung für ' + (item.requested_locale || requestedLocale()) + ' vorhanden.'
        : item.description || 'Keine Beschreibung in der Quelle.'));
      const meta = node('div', null, 'card-meta');
      if (kind !== 'mcp') meta.append(badge(item.version || 'Ohne Versionsnummer'));
      if (kind === 'skills') {
        meta.append(badge(item.category || 'Allgemein'));
        if (item.resolved_locale) meta.append(badge(item.resolved_locale + (item.fallback_used ? ' · Fallback' : '')));
        else meta.append(badge('Sprachfassung fehlt'));
        const edit = button('Anleitung bearbeiten', () => openSkill(item.id), 'btn card-action');
        if (item.missing_locale) { edit.disabled = true; edit.title = 'Für diese Sprachfassung nicht verfügbar.'; }
        card.append(meta, node('p', item.id, 'card-caption'), edit);
      } else {
        if (item.consumer) meta.append(badge(item.consumer));
        card.append(meta);
        if (kind === 'plugins') {
          card.append(node('p', item.code_present ? 'Plugin-Dateien vorhanden' : 'Installationsverweis ohne erreichbare Dateien'));
          card.append(plugCableElement(item, fetchedAt));
        } else if (kind === 'mcp') {
          card.append(node('p', 'Im Client konfiguriert · ' + item.transport));
          if (item.command_name || item.hostname) card.append(node('p', item.command_name || item.hostname, 'card-caption'));
          card.append(node('p', flag(item.enabled_in_client), 'card-caption'));
        } else if (kind === 'software') {
          if (item.category) meta.append(badge(item.category));
          card.append(node('p', 'Im Anwendungskatalog erfasst'));
          card.append(node('p', item.installed === true ? 'Installation bestätigt' : 'Installation nicht erfasst', 'card-caption'));
          for (const publication of item.publications || []) {
            const url = safePublicationUrl(publication.url);
            const label = publicationLabel(publication);
            if (url) {
              const link = node('a', label, 'card-caption');
              link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
              card.append(link);
            } else card.append(node('p', label, 'card-caption'));
          }
        } else card.append(node('p', 'Modul- oder Repository-Quellen vorhanden'));
        const detail = node('details'), summary = node('summary', 'Quelle');
        detail.append(summary, node('p', item.path || item.source || 'Quelle nicht angegeben'));
        card.append(detail);
      }
      byId('board-items').append(card);
    }
    if (!visible.length) byId('board-items').append(node('p', query || category ? 'Keine passenden Einträge.' : 'In den erreichbaren Quellen sind keine Einträge vorhanden.'));
  }

  async function refresh() {
    const generation = ++inventoryGeneration;
    byId('board-status').textContent = 'Host-Quellen werden gelesen …';
    byId('board-refresh').disabled = true;
    try {
      const data = await requestJson(INVENTORIES[kind]);
      if (generation !== inventoryGeneration) return;
      if (!catalogMatches(kind, data)) throw new Error(kind === 'plugins'
        ? 'Die Antwort ist kein Plugin-Inventar (erwartet: Schema bach.capability-inventory.v1, Art plugins).'
        : 'Der Anwendungskatalog und die Ocean-Quellen sind noch nicht getrennt angebunden.');
      if (kind === 'skills') activeLocale = typeof data.requested_locale === 'string' ? data.requested_locale : requestedLocale();
      const rows = kind === 'skills' ? [...data.skills, ...(data.unresolved_skills || []).map(item => ({...item, missing_locale: true}))] : data.items;
      if (!Array.isArray(rows)) throw new Error('Die Quelle liefert keinen Eintragskatalog.');
      items = rows;
      fetchedAt = new Date();
      if (kind === 'skills') {
        const select = byId('board-category'), previous = select.value;
        select.replaceChildren(new Option('Alle Kategorien', ''));
        for (const category of [...new Set(items.map(item => item.category).filter(Boolean))].sort()) select.add(new Option(category, category));
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
        const localeSelect = byId('board-locale'), localePrevious = selectedLocale;
        localeSelect.replaceChildren(new Option('Systemsprache (' + activeLocale + ')', ''));
        for (const locale of data.available_locales || []) localeSelect.add(new Option(locale, locale));
        if (localePrevious && ![...localeSelect.options].some(option => option.value === localePrevious))
          localeSelect.add(new Option(localePrevious, localePrevious));
        localeSelect.value = localePrevious;
      }
      const notes = [];
      if (kind === 'plugins') notes.push(plugSummaryText(items) + '. Die Einstellungen stammen aus den Client-Dateien (Claude und Codex); der Laufzeitstatus der Clients ist nicht erfasst. Diese Ansicht schaltet nichts.');
      if (kind === 'mcp') notes.push('Die Verbindungen werden von den jeweiligen Clients verwaltet. Eine laufende MCP-Sitzung ist hier nicht nachgewiesen.');
      if (kind === 'software') notes.push('Anwendungen aus dem Software-Register. Veröffentlichungsangaben sind der Registerstand; Installationen und Store-Verfügbarkeit sind nicht geprüft.');
      if (kind === 'ocean') notes.push('Die Liste zeigt Modul- und Repository-Quellen auf diesem Host. Eine Installation oder ein laufender Dienst ist damit nicht nachgewiesen.');
      if (data.truncated) notes.push('Die Lesegrenze wurde erreicht; die Liste ist unvollständig.');
      if (data.errors?.length) notes.push(data.errors.length + ' Quelle(n) konnten nicht gelesen werden.');
      if (data.sources?.length && data.sources.every(source => !source.available)) notes.push('Keine konfigurierte Quelle ist erreichbar.');
      if (kind === 'skills') notes.unshift('Sprachfassung: ' + activeLocale + (selectedLocale ? '' : ' (Systemsprache)') + '.');
      byId('board-status').textContent = notes.join(' ') || 'Aktuelle SKILL.md-Dateien geladen.';
      const sources = byId('board-sources');
      if (sources) {
        sources.replaceChildren();
        for (const source of data.sources || []) sources.append(node('p', (source.available ? 'Erreichbar: ' : 'Nicht erreichbar: ') + source.path));
        for (const error of data.errors || []) sources.append(node('p', 'Nicht lesbar: ' + error.source + ' (' + error.reason + ')'));
      }
      renderItems();
    } catch (error) {
      if (generation !== inventoryGeneration) return;
      items = []; renderItems();
      byId('board-status').textContent = 'Quelle nicht geladen: ' + describeSourceError(error);
    } finally { if (generation === inventoryGeneration) byId('board-refresh').disabled = false; }
  }

  const editor = byId('skill-editor');
  let currentSource = null, editorBusy = false, editorGeneration = 0, originalContent = '', selectedHistory = '';
  function busy(value) {
    editorBusy = value;
    for (const id of ['skill-content', 'skill-id', 'skill-history', 'skill-reload', 'skill-close']) byId(id).disabled = value;
    byId('skill-id').readOnly = currentSource?.source_version !== '0';
    byId('skill-history').disabled = value || !currentSource || currentSource.source_version === '0';
    byId('skill-reload').disabled = value || !currentSource || currentSource.source_version === '0';
    byId('skill-save').disabled = value || !currentSource;
    for(const button of byId('skill-symbols').querySelectorAll('button'))button.disabled=value||!currentSource;
  }
  function drawSkillSymbols(source=currentSource) {
    mountSymbolPicker(byId('skill-symbols'),source?.symbol,symbolUrls,value=>{
      if(editorBusy||!currentSource)return;
      try {
        byId('skill-content').value=withSkillSymbol(byId('skill-content').value,value);
        drawSkillSymbols({symbol:value});
      } catch(error) {byId('skill-editor-status').textContent=error.message;}
    },'wissen');
  }
  function describeSource() {
    byId('skill-source-info').textContent = currentSource?.source_version === '0' ? 'Neue lokale Anleitung. Eine bestehende Kennung wird nicht überschrieben.'
      : currentSource ? (currentSource.version || 'Ohne Versionsnummer') + ' · Quelle ' + currentSource.source_version.slice(0, 12) : 'Aktuelle Quelle wird geladen …';
  }
  async function loadHistory() {
    const select = byId('skill-history');
    selectedHistory = '';
    select.replaceChildren(new Option('Aktuelle Fassung', ''));
    if (!currentSource || currentSource.source_version === '0') return;
    const history = await requestJson(withLocale('/api/capabilities/skills/' + encodeURIComponent(currentSource.id) + '/history', requestedLocale()));
    if (!Array.isArray(history.versions)) throw new Error('Die Historie liefert keine Fassungen.');
    for (const entry of history.versions) select.add(new Option((entry.version || 'Ohne Versionsnummer') + ' · ' + entry.source_version.slice(0, 12), entry.source_version));
    if (history.truncated) byId('skill-editor-status').textContent = 'Die Historie ist wegen der Lesegrenze unvollständig.';
  }
  async function openSkill(id) {
    const generation = ++editorGeneration;
    currentSource = null; originalContent = '';
    byId('skill-editor-title').textContent = 'Skill bearbeiten'; byId('skill-id').value = id;
    byId('skill-content').value = ''; byId('skill-history').replaceChildren(new Option('Aktuelle Fassung', ''));
    byId('skill-editor-status').textContent = ''; describeSource(); busy(true); editor.showModal();
    try {
      const source = await loadSkill(id, requestedLocale());
      if (generation !== editorGeneration) return;
      currentSource = source; originalContent = source.content; byId('skill-content').value = source.content; describeSource();drawSkillSymbols();
      try { await loadHistory(); }
      catch (error) { byId('skill-editor-status').textContent = 'Aktuelle Fassung geladen. Historie nicht lesbar: ' + error.message; }
    } catch (error) { byId('skill-editor-status').textContent = 'Bearbeitung nicht freigegeben: ' + error.message; }
    finally { if (generation === editorGeneration) busy(false); }
  }
  function closeEditor() {
    if (editorBusy) return;
    if (byId('skill-content').value !== originalContent && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    ++editorGeneration; editor.close();
  }
  byId('skill-close').addEventListener('click', closeEditor);
  editor.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  byId('skill-create')?.addEventListener('click', () => {
    ++editorGeneration; currentSource = {id:'',source_version:'0'};
    selectedHistory = '';
    originalContent = '---\nname: neuer-skill\ndescription: Aufgabe und Einsatz der Anleitung\nversion: 1.0.0\n---\n\n# Neuer Skill\n\n## Vorgehen\n\n1. Beschreibe die Arbeitsschritte.\n';
    byId('skill-editor-title').textContent = 'Neuer Skill'; byId('skill-id').value = '';
    byId('skill-content').value = originalContent; byId('skill-editor-status').textContent = '';
    byId('skill-history').replaceChildren(new Option('Aktuelle Fassung', ''));
    describeSource();drawSkillSymbols(); busy(false); editor.showModal(); byId('skill-id').focus();
  });
  byId('skill-reload').addEventListener('click', async () => {
    if (!currentSource || editorBusy) return;
    if (byId('skill-content').value !== originalContent && !window.confirm('Aktuelle Fassung laden und ungespeicherte Änderungen verwerfen?')) return;
    busy(true);
    try {
      currentSource = await loadSkill(currentSource.id, requestedLocale()); originalContent = currentSource.content;
      byId('skill-content').value = originalContent; describeSource();drawSkillSymbols(); await loadHistory();
      byId('skill-editor-status').textContent = 'Aktuelle Fassung geladen.';
    } catch (error) { byId('skill-editor-status').textContent = error.message; }
    finally { busy(false); }
  });
  byId('skill-history').addEventListener('change', async () => {
    if (!currentSource || editorBusy) return;
    const revision = byId('skill-history').value;
    if (!confirmSkillReplacement(byId('skill-content').value, originalContent, message => window.confirm(message))) {
      byId('skill-history').value = selectedHistory;
      return;
    }
    busy(true);
    try {
      const source = revision ? await requestJson(withLocale('/api/capabilities/skills/' + encodeURIComponent(currentSource.id) + '/history/' + encodeURIComponent(revision), requestedLocale())) : currentSource;
      if (typeof source.content !== 'string' || (revision && source.source_version !== revision)) throw new Error('Historische Quelle konnte nicht bestätigt werden.');
      byId('skill-content').value = source.content;
      drawSkillSymbols(source);
      selectedHistory = revision;
      byId('skill-editor-status').textContent = revision ? 'Frühere Fassung als Vorlage geladen. Speichern erzeugt die neue aktuelle Fassung.' : 'Geladene aktuelle Fassung wieder eingesetzt.';
    } catch (error) { byId('skill-history').value = selectedHistory; byId('skill-editor-status').textContent = error.message; }
    finally { busy(false); }
  });
  byId('skill-save').addEventListener('click', async () => {
    if (!currentSource || editorBusy) return;
    const id = byId('skill-id').value.trim();
    if (!SKILL_ID.test(id)) { byId('skill-editor-status').textContent = 'Eine gültige Kennung ist erforderlich.'; return; }
    busy(true); byId('skill-editor-status').textContent = 'Quelle wird gespeichert und erneut gelesen …';
    try {
      currentSource = await saveSkill({...currentSource,id}, byId('skill-content').value, requestedLocale());
      originalContent = currentSource.content; describeSource();drawSkillSymbols();
      byId('skill-editor-title').textContent = 'Skill bearbeiten';
      byId('skill-editor-status').textContent = 'Gespeicherte aktuelle Fassung bestätigt.';
      try { await loadHistory(); } catch (error) { byId('skill-editor-status').textContent += ' Historie nicht geladen: ' + error.message; }
      await refresh();
    } catch (error) { byId('skill-editor-status').textContent = error.message; }
    finally { busy(false); }
  });

  const recipeDialog = byId('recipe-editor');
  byId('recipe-close').addEventListener('click', () => recipeDialog.close());
  function showRecipe(book) {
    byId('recipe-title').textContent = book.title || book.id;
    byId('recipe-description').textContent = 'Anleitungsvorlage · ' + (book.description || '') + ' Der Laufzeitstatus ist nicht geprüft.';
    const content = byId('recipe-content'); content.replaceChildren();
    const tools = book.pages?.page_2_tools?.tools || [];
    const toolSection = node('section'); toolSection.append(node('h3', 'Werkzeuge'));
    for (const tool of tools) toolSection.append(node('p', tool.name + (tool.description ? ': ' + tool.description : '')));
    content.append(toolSection, node('h3', 'Rezepte'));
    for (const recipe of book.recipes || book.pages?.page_3_recipes?.recipes || []) {
      const article = node('article'), status = node('p', '', 'copy-status');
      article.append(node('h4', recipe.title), node('pre', recipe.prompt || ''));
      article.append(button('Rezept kopieren', async () => {
        try { await navigator.clipboard.writeText(recipe.prompt || ''); status.textContent = 'Kopiert.'; }
        catch { status.textContent = 'Zwischenablage nicht erreichbar. Text bitte auswählen und kopieren.'; }
      }), status); content.append(article);
    }
    const governance = book.pages?.page_4_governance || {};
    content.append(node('h3', 'Einsatzhinweise'));
    content.append(node('p', governance.mode_note || governance.mode_restrictions || governance.safety_note || 'Die tatsächlichen Werkzeuge und Rechte werden vom jeweiligen Client bestimmt.'));
    recipeDialog.showModal();
  }
  async function loadRecipes() {
    try {
      const data = await requestJson('/api/capabilities/mcp/cookbooks');
      if (!Array.isArray(data.cookbooks)) throw new Error('Keine Rezeptbibliothek in der Antwort.');
      byId('recipe-books').replaceChildren();
      for (const book of data.cookbooks) {
        const entry = button('', () => showRecipe(book), 'recipe-book');
        entry.append(node('small', 'MCP · Anleitungsvorlage'), node('strong', book.title || book.id), node('small', book.description || ''), node('span', 'Rezepte ansehen →'));
        byId('recipe-books').append(entry);
      }
      byId('recipe-status').textContent = data.cookbooks.length + ' Rezeptbücher. Die Anleitungen führen keine Werkzeuge aus.';
    } catch (error) { byId('recipe-status').textContent = 'Rezeptbibliothek nicht geladen: ' + error.message; }
  }
  byId('board-search').addEventListener('input', () => { currentPage = 1; renderItems(); });
  byId('board-category')?.addEventListener('change', () => { currentPage = 1; renderItems(); });
  byId('board-locale')?.addEventListener('change', event => {
    selectedLocale = event.target.value;
    try {
      if (selectedLocale) window.sessionStorage.setItem('bach.skills.locale', selectedLocale);
      else window.sessionStorage.removeItem('bach.skills.locale');
    } catch {}
    currentPage = 1; refresh();
  });
  byId('board-prev').addEventListener('click', () => { currentPage--; renderItems(); });
  byId('board-next').addEventListener('click', () => { currentPage++; renderItems(); });
  byId('board-refresh').addEventListener('click', refresh);
  refresh(); if (kind === 'mcp') loadRecipes();
}
