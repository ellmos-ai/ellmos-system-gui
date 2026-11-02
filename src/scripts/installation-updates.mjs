import {
  INVENTORY_SOURCES,
  hasAdvertisedReadRoute,
  installerActionState,
  isCapabilitiesDocument,
  liveReleaseState,
  managementHref,
  normalizeInventory,
  stateLabel,
} from '../lib/installation-updates-model.mjs';

const root = document.querySelector('[data-installation-updates]');
if (root) {
  const elements = {
    backendName: document.querySelector('#backend-name'),
    backendDetail: document.querySelector('#backend-detail'),
    targetHost: document.querySelector('#target-host'),
    catalogCount: document.querySelector('#catalog-count'),
    observedAt: document.querySelector('#observed-at'),
    lifecycleBadge: document.querySelector('#lifecycle-badge'),
    lifecycleReason: document.querySelector('#lifecycle-reason'),
    lifecycleDiagnostic: document.querySelector('#lifecycle-diagnostic'),
    inventoryDiagnostic: document.querySelector('#inventory-diagnostic'),
    catalogStatus: document.querySelector('#catalog-status'),
    catalogGrid: document.querySelector('#catalog-grid'),
    catalogEmpty: document.querySelector('#catalog-empty'),
    search: document.querySelector('#catalog-search'),
    refresh: document.querySelector('#install-refresh'),
  };
  let viewSources = [];

  async function requestJson(url) {
    const response = await fetch(url, {
      headers: {Accept: 'application/json'},
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('Die Quelle lieferte keine lesbare JSON-Antwort.'); }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function formatObservedAt(value) {
    if (typeof value !== 'string' || !value) return 'Nicht geliefert';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return 'Ungültiger Zeitstempel';
    return new Intl.DateTimeFormat('de-DE', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC'}).format(date) + ' UTC';
  }

  function safeText(value, fallback = 'Nicht geliefert') {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    const text = value.trim();
    if (/(?:^|[\s("'=])(?:[a-z]:[\\/]|\\\\|\/|~[\\/])/i.test(text)) return fallback;
    return text.slice(0, 180);
  }

  function setLifecycle(capabilities) {
    const state = installerActionState(capabilities);
    setText(elements.lifecycleBadge, state.enabled ? 'Installationsdienst verbunden' : 'Installationsdienst noch nicht verbunden');
    setText(elements.lifecycleReason, state.enabled
      ? 'Installieren, Aktualisieren und Entfernen sind über die Systemanbindung verfügbar.'
      : 'Installieren, Aktualisieren und Entfernen sind hier noch nicht verfügbar. Die belegten Bestände bleiben davon getrennt sichtbar.');
    setText(elements.lifecycleDiagnostic, state.reason);
    if (state.registeredRoutes > 0) {
      setText(elements.lifecycleDiagnostic, `${state.reason} Registrierte Installationsrouten: ${state.registeredRoutes}; ihr Payload- und Freigabevertrag ist hier nicht bestätigt.`);
    }
  }

  function makeFact(label, value) {
    const chip = document.createElement('span');
    chip.className = 'fact-chip';
    chip.textContent = `${label}: ${value}`;
    return chip;
  }

  function renderItem(item, source) {
    const row = document.createElement('article');
    row.className = 'component-row';
    const heading = document.createElement('h4');
    heading.textContent = safeText(item.name, 'Unbenannte Komponente');
    row.append(heading);
    const facts = document.createElement('div');
    facts.className = 'component-facts';
    facts.append(makeFact('Im Katalog verfügbar', stateLabel(item.catalogAvailable, 'Ja', 'Nein', 'Unbekannt')));
    facts.append(makeFact('Installierbarkeit', 'Nicht geprüft'));
    facts.append(makeFact('Installiert', stateLabel(item.installed, 'Ja', 'Nein', 'Unbekannt')));
    facts.append(makeFact('Laufzeit', stateLabel(item.runtimeActive, 'Läuft', 'Läuft nicht', 'Unbekannt')));
    if (item.codePresent !== null) facts.append(makeFact('Quelldateien', item.codePresent ? 'Vorhanden' : 'Nicht vorhanden'));
    if (item.enabledInClient !== null) facts.append(makeFact('Client-Schalter', item.enabledInClient ? 'Ein' : 'Aus'));
    if (item.version) facts.append(makeFact('Version', safeText(item.version)));
    if (item.sourceVersion) facts.append(makeFact('Quellrevision', safeText(item.sourceVersion)));
    if (item.category) facts.append(makeFact('Kategorie', safeText(item.category)));
    if (item.connectionState) facts.append(makeFact('Verbindung', safeText(item.connectionState)));
    for (const publication of item.publications) {
      if (publication.version || publication.declaredStatus) {
        const detail = [publication.version, publication.declaredStatus].filter(Boolean).join(' · ');
        facts.append(makeFact(publication.liveVerified ? 'Release geprüft' : 'Release laut Register', detail));
      }
    }
    if (item.evidence) facts.append(makeFact('Beleg', safeText(item.evidence)));
    row.append(facts);
    const href = managementHref(source.definition, item);
    if (href) {
      const manage = document.createElement('a');
      manage.className = 'component-manage-link';
      manage.href = href;
      manage.textContent = 'Komponente verwalten ↗';
      row.append(manage);
    }
    return row;
  }

  function renderSources() {
    const search = (elements.search?.value || '').trim().toLocaleLowerCase('de-DE');
    elements.catalogGrid.replaceChildren();
    let visibleCount = 0;
    for (const source of viewSources) {
      const sourceItems = source.items.filter((item) => {
        const haystack = `${item.name} ${item.category}`.toLocaleLowerCase('de-DE');
        return !search || haystack.includes(search);
      });
      if (search && sourceItems.length === 0) continue;
      const card = document.createElement('article');
      card.className = 'catalog-card';
      const head = document.createElement('div');
      head.className = 'catalog-card-head';
      const headingWrap = document.createElement('div');
      const heading = document.createElement('h3');
      heading.textContent = source.definition.label;
      const intro = document.createElement('p');
      intro.className = 'catalog-card-intro';
      intro.textContent = source.loaded
        ? `${sourceItems.length} Katalogeinträge · Online-Änderungen noch nicht geprüft`
        : source.reason;
      headingWrap.append(heading, intro);
      const badge = document.createElement('span');
      badge.className = 'source-badge';
      badge.dataset.state = source.loaded ? 'loaded' : 'missing';
      badge.textContent = source.loaded ? 'Gelesen' : 'Nicht verbunden';
      head.append(headingWrap, badge);
      card.append(head);
      if (source.loaded && sourceItems.length > 0) {
        const list = document.createElement('div');
        list.className = 'component-list';
        for (const item of sourceItems) list.append(renderItem(item, source));
        card.append(list);
        visibleCount += sourceItems.length;
      } else {
        const empty = document.createElement('p');
        empty.className = 'empty-source';
        empty.textContent = source.loaded
          ? 'Für diesen Bestand gibt es keine passenden Einträge.'
        : 'Dieser Bestand ist aktuell nicht lesbar.';
        card.append(empty);
      }
      elements.catalogGrid.append(card);
    }
    const hasLoadedSource = viewSources.some((source) => source.loaded);
    elements.catalogEmpty.hidden = visibleCount > 0 || viewSources.length === 0 || !hasLoadedSource;
  }

  async function loadSource(definition, capabilities) {
    if (!hasAdvertisedReadRoute(capabilities, definition.route)) {
      return {definition, loaded: false, items: [], reason: 'Dieser Bestand ist noch nicht an die Systemanbindung angeschlossen.'};
    }
    try {
      const payload = await requestJson(definition.route);
      const items = normalizeInventory(definition, payload);
      return {definition, loaded: true, items, reason: ''};
    } catch (error) {
      const reason = error.status === 401 || error.status === 403
        ? 'Für diesen Bestand ist eine gültige Geräteanmeldung erforderlich.'
        : 'Der Bestand konnte gerade nicht bestätigt werden.';
      return {definition, loaded: false, items: [], reason};
    }
  }

  async function loadPage() {
    elements.refresh.disabled = true;
    setText(elements.catalogStatus, 'Bestände werden gelesen …');
    try {
      const [capabilitiesResult, backendResult] = await Promise.allSettled([
        requestJson('/api/gui/capabilities'),
        requestJson('/api/gui/backend-origin'),
      ]);
      const capabilities = capabilitiesResult.status === 'fulfilled' && isCapabilitiesDocument(capabilitiesResult.value)
        ? capabilitiesResult.value
        : null;
      const backend = backendResult.status === 'fulfilled' ? backendResult.value : null;
      setText(elements.backendName, safeText(capabilities?.system?.id, 'Backend unbekannt'));
      setText(elements.backendDetail, 'Bestandsabfrage wird geladen.');
      setText(elements.targetHost, 'Noch nicht bekannt');
      setText(elements.observedAt, formatObservedAt(capabilities?.observed_at));
      setLifecycle(capabilities);
      const backendMode = typeof backend?.mode === 'string' ? safeText(backend.mode, 'unbekannt') : 'unbekannt';
      setText(elements.backendDetail, `Verbindung: ${backendMode}`);
      viewSources = await Promise.all(INVENTORY_SOURCES.map((source) => loadSource(source, capabilities)));
      const loaded = viewSources.filter((source) => source.loaded).length;
      const records = viewSources.reduce((sum, source) => sum + source.items.length, 0);
      setText(elements.catalogCount, `${loaded}/${INVENTORY_SOURCES.length} Bestände`);
      setText(elements.catalogStatus, capabilities
        ? `${records} Einträge aus ${loaded} verbundenen Beständen. Aktivierung und Zuordnung verwaltest du in den bestehenden Skills-&-Software-Ansichten.`
        : 'Die Systemanbindung konnte nicht bestätigt werden; Bestände bleiben unbekannt.');
      const adapterVersion = capabilities?.system?.adapter_version
        ? ` Adapterversion ${safeText(String(capabilities.system.adapter_version))}.`
        : ' Keine Adapterversion geliefert.';
      setText(elements.inventoryDiagnostic, `${loaded} von ${INVENTORY_SOURCES.length} lesbaren Bestandsbereichen sind verbunden. Für Bundles ist kein Inventarbereich registriert.${adapterVersion}`);
      const release = liveReleaseState(capabilities);
      if (release === 'unavailable') {
        setText(elements.catalogStatus, `${elements.catalogStatus.textContent} Online-Versionen und Änderungen sind noch nicht angebunden.`);
      } else if (release === 'route-registered-unverified') {
        setText(elements.inventoryDiagnostic, `${elements.inventoryDiagnostic.textContent} Eine Online-Release-Route ist registriert, aber ihre Quelle ist noch nicht bestätigt.`);
      }
    } catch {
      setText(elements.backendName, 'Backend unbekannt');
      setText(elements.backendDetail, 'Systemanbindung konnte nicht bestätigt werden.');
      setText(elements.targetHost, 'Nicht belegt');
      setText(elements.observedAt, 'Nicht gelesen');
      setLifecycle(null);
      setText(elements.inventoryDiagnostic, 'Die Bestandsverbindungen konnten nicht gelesen werden.');
      setText(elements.catalogCount, 'Nicht geprüft');
      setText(elements.catalogStatus, 'Die Bestände konnten nicht gelesen werden. Ein Verbindungsfehler bedeutet nicht, dass sie leer sind.');
      viewSources = [];
    } finally {
      renderSources();
      elements.refresh.disabled = false;
    }
  }

  elements.refresh?.addEventListener('click', loadPage);
  elements.search?.addEventListener('input', renderSources);
  loadPage();
}
