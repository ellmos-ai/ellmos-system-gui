import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatSkillOrigin} from '../src/lib/capability-board-ui.mjs';

const capabilityBoardAstro = readFileSync(new URL('../src/components/CapabilityBoard.astro', import.meta.url), 'utf8');
const skillsAstro = readFileSync(new URL('../src/pages/skills.astro', import.meta.url), 'utf8');
const helpAstro = readFileSync(new URL('../src/pages/help.astro', import.meta.url), 'utf8');
const capabilityBoardUiMjs = readFileSync(new URL('../src/lib/capability-board-ui.mjs', import.meta.url), 'utf8');

test('PB-25 Punkt (1): Skills-Bibliothek bereinigt - keine "BACH vanilla" Dummies & klare Herkunft', () => {
  // Keine veralteten BACH vanilla Platzhalter
  assert.equal(capabilityBoardAstro.includes('BACH vanilla'), false);
  assert.equal(skillsAstro.includes('BACH vanilla'), false);
  assert.equal(helpAstro.includes('BACH vanilla'), false);

  // formatSkillOrigin weist Herkunft sauber zu
  assert.equal(formatSkillOrigin({origin: 'mac-studio'}), 'Mac Studio');
  assert.equal(formatSkillOrigin({source: 'mac-studio/skills'}), 'Mac Studio');
  assert.equal(formatSkillOrigin({system: 'studio'}), 'Mac Studio');
  assert.equal(formatSkillOrigin({origin: 'bach'}), 'BACH');
  assert.equal(formatSkillOrigin({source_system: 'bach-core'}), 'BACH');
  assert.equal(formatSkillOrigin({path: '/User/OneDrive/.TOPICS/.AI/.SKILLS/skills/dev'}), 'Ocean .SKILLS');
  assert.equal(formatSkillOrigin({origin: 'ocean'}), 'Ocean .SKILLS');
  assert.equal(formatSkillOrigin({}), 'Ocean .SKILLS');

  // Ehrliche Meldung bei leerer/offline Quelle
  assert.match(capabilityBoardUiMjs, /Skill-Bibliothek nicht geladen \(\/api\/capabilities bzw\. \/api\/skills offline\)/);
  assert.match(capabilityBoardUiMjs, /Keine Skills verfügbar\. Die Skill-Bibliothek \(\/api\/capabilities bzw\. \/api\/skills\) ist offline/);
});

test('PB-25 Punkt (4): Persona-Routing ersetzt veraltete statische Zuordnung', () => {
  // Tab und Panel für Persona-Routing vorhanden
  assert.match(capabilityBoardAstro, /data-skills-tab="persona-routing"/);
  assert.match(capabilityBoardAstro, /data-tab="persona-routing"/);
  assert.match(capabilityBoardAstro, /id="persona-routing-panel"/);

  // Verlinkung zur Agenten-Bibliothek
  assert.match(capabilityBoardAstro, /href="\/agenten\/blueprints"/);
  assert.match(capabilityBoardAstro, /Agenten-Bibliothek/);

  // Dynamisches Persona-Routing erklärt
  assert.match(capabilityBoardAstro, /Dynamisches Persona-Routing/);
  assert.match(capabilityBoardAstro, /dynamisch über <strong>Agenten-Profile und Personas<\/strong> geroutet/);

  // Altes Zuordnungs-Tab existiert nicht mehr
  assert.equal(capabilityBoardAstro.includes('data-skills-tab="zuordnung"'), false);
  assert.equal(capabilityBoardAstro.includes('id="tab-zuordnung"'), false);
});

test('PB-25 Punkt (10): Doku zum kognitiven System mit 5 Memory-Punkten & Memory-Karte', () => {
  assert.match(helpAstro, /id="kognitives-system-memory"/);
  assert.match(helpAstro, /data-help-cognitive-memory="true"/);
  assert.match(helpAstro, /data-section-role="documentation"/);

  // 5 Gedächtnisschichten
  assert.match(helpAstro, /Arbeitsgedächtnis/);
  assert.match(helpAstro, /Working Memory/);
  assert.match(helpAstro, /Episodisches Gedächtnis/);
  assert.match(helpAstro, /Session Snapshots/);
  assert.match(helpAstro, /Semantisches Gedächtnis/);
  assert.match(helpAstro, /Memory Facts/);
  assert.match(helpAstro, /Notiz- &amp; Ideenspeicher/);
  assert.match(helpAstro, /llm-note/);
  assert.match(helpAstro, /Konsolidierung/);
  assert.match(helpAstro, /Sleep \/ Gardener/);
  assert.match(helpAstro, /memoryhooker/);

  // Memory-Karte (Topologie)
  assert.match(helpAstro, /class="memory-map-table"/);
  assert.match(helpAstro, /data-memory-map="topology"/);
  assert.match(helpAstro, /Memory-Karte \(Gedächtnis-Topologie/);
});

test('PB-25 Punkt (11): Saubere Trennung zwischen Dokumentation und Interaktion', () => {
  // Interaktions-Leiste klar abgegrenzt
  assert.match(helpAstro, /data-section-role="interaction-links"/);
  assert.match(helpAstro, /class="help-interaction-bar card"/);
  assert.match(helpAstro, /Direkte System-Interaktion \(Operative Ansichten\)/);

  // Links zu den operativen Ansichten
  assert.match(helpAstro, /href="\/memory"/);
  assert.match(helpAstro, /\/agenten\/memory/);
  assert.match(helpAstro, /href="\/skills"/);
  assert.match(helpAstro, /href="\/notizen"/);
  assert.match(helpAstro, /href="\/routinen"/);

  // Dokumentationsabschnitte tragen data-section-role="documentation"
  assert.match(helpAstro, /data-section-role="documentation"/);
});

test('PB-25 Punkt (12): Ocean-Dokusystem (doc-keeper & help_projection) sichtbar angebunden', () => {
  assert.match(helpAstro, /id="ocean-doc-system"/);
  assert.match(helpAstro, /data-help-ocean-docs="true"/);
  assert.match(helpAstro, /data-doc-keeper="true"/);
  assert.match(helpAstro, /data-help-projection="true"/);

  // doc-keeper & help_projection Erwähnung und BACH /api/help Kompatibilität
  assert.match(helpAstro, /ellmos-doc-keeper/);
  assert.match(helpAstro, /help_projection\.py/);
  assert.match(helpAstro, /\/api\/help/);

  // Themen-Katalog
  assert.match(helpAstro, /class="doc-topic-catalog"/);
  assert.match(helpAstro, /<code>core<\/code>/);
  assert.match(helpAstro, /<code>modules<\/code>/);
  assert.match(helpAstro, /<code>skills<\/code>/);
  assert.match(helpAstro, /<code>mcp<\/code>/);
  assert.match(helpAstro, /<code>api<\/code>/);
  assert.match(helpAstro, /<code>operations<\/code>/);

  // 6-Sprachen-Parität
  assert.match(helpAstro, /class="doc-language-parity"/);
  for (const lang of ['de', 'en', 'es', 'ja', 'ru', 'zh']) {
    assert.match(helpAstro, new RegExp(`<code>${lang}</code>`));
  }
});
