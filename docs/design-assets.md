# Design Assets Dokumentation & Spezifikation
**ellmos-system-gui — Gemeinsames Asset-Paket für BACH und OCEAN**

> **Repository:** `ellmos-system-gui` · gemeinsamer BACH/Ocean-Frontend-Quellstand
> **Task:** BACH Task #1692 · Icon-System und gemeinsame Rollen-/Modul-Assets
> **Datum:** 2026-10-05
> **Kontaktblatt:** [design-assets-contact-sheet.png](design-assets-contact-sheet.png)

---

## 1. Übersicht & Design-System-Integration

Dieses Asset-Paket stellt die visuelle Basis für die gemeinsame Astro-5-Oberfläche (`ellmos-system-gui`) dar, die sowohl von **BACH** als auch von **OCEAN** konsumiert wird.

### Branding-Kompatibilität (BACH vs. OCEAN)
Alle Assets sind strikt themeneutral gestaltet und passen sich über die Design-Tokens an:
- **BACH-Branding:** Akzentfarbe `--accent: #d4485a` (Karminrot), Hintergrund `--bg-dark: #0b0d14`, Panel `--bg-panel: #111420`.
- **OCEAN-Branding:** Akzentfarbe `--accent: #0ea5e9` (Himmelblau), Hintergrund `--bg-dark: #070d18`, Panel `--bg-panel: #0c1728`.
- **Icons:** Arbeiten mit `stroke="currentColor"` und `fill="none"`. Dadurch erben sie im Navigationszustand direkt die jeweilige Menü- oder Akzentfarbe beider Brandings.
- **Porträts:** Auf echten transparenten Alpha-Hintergründen isoliert (RGBA), sodass sie sich nahtlos über BACH- und OCEAN-Kartenflächen und Hintergründe legen.
- **Werkstatt-Hintergrund:** Warmes, fotorealistisches Holzwerkstatt-Ambiente mit weicher Tiefenschärfe im Zentrum, das sowohl mit roten als auch blauen semitransparenten Glaselementen harmonisiert.

### Einbindungsstand
- Die 16 Navigationsicons und sechs Life-Modul-Icons sind im gemeinsamen Astro-Header über `iconId` in `nav_config.json` eingebunden. Zwölf zusätzliche Rollenicons stehen als wiederverwendbare SVGs bereit und erscheinen in den Blaupausenkarten.
- Agentenporträts erscheinen in der dynamisch geladenen Blaupausenliste, wenn die Rolle einer der zwölf bekannten Vorlagen entspricht. Der Werkstatt-Hintergrund wird im Kopfbereich der Agenten-Werkstatt verwendet.
- Die lokale Astro-Build-Prüfung ist bestanden. Das Asset-Paket ist noch nicht als Release gebaut oder in BACH/Ocean installiert.

---

## 2. Navigations- und Menü-Icons (16 Icons)

Die Icons decken alle 9 Hauptmenüpunkte aus `src/config/nav_config.json`, sechs zugeordnete Agenten-Untermenüpunkte und den MarbleRun-Bereich der Agenten-Werkstatt ab.

### Stil-Vorgaben & Technische Kriterien
- **ViewBox:** Einheitlich `0 0 24 24`
- **Linienstärke:** `stroke-width="2"` (über Props anpassbar)
- **Kanten:** `stroke-linecap="round"` und `stroke-linejoin="round"`
- **Farbe:** Kontur gesteuert über `currentColor` (keine harten Farbcodes im Vektor)
- **Sicherheit:** 100 % sauberes XML. Keine externen Referenzen (`http:`, `xlink:href`), keine `<script>`-Tags, keine fremden Abhängigkeiten.

### Icon-Inventar

| Name | Menüpunkt / Zielseite | SVG-Quellpfad | Astro-Komponente | Format | ViewBox | Dateigröße |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `dashboard` | Dashboard / Übersicht (`/`) | `design/assets-source/icons/navigation/dashboard.svg` | `src/components/icons/navigation/DashboardIcon.astro` | SVG | 24×24 | 388 B |
| `tasks` | Aufgaben & Taskboard (`/tasks`) | `design/assets-source/icons/navigation/tasks.svg` | `src/components/icons/navigation/TasksIcon.astro` | SVG | 24×24 | 334 B |
| `assistant` | Persönlicher Assistent (`/chat`) | `design/assets-source/icons/navigation/assistant.svg` | `src/components/icons/navigation/AssistantIcon.astro` | SVG | 24×24 | 352 B |
| `life` | Life-Zentrale & Routinen (`/life`) | `design/assets-source/icons/navigation/life.svg` | `src/components/icons/navigation/LifeIcon.astro` | SVG | 24×24 | 304 B |
| `agenten` | Agenten-Übersicht (`/agenten`) | `design/assets-source/icons/navigation/agenten.svg` | `src/components/icons/navigation/AgentenIcon.astro` | SVG | 24×24 | 424 B |
| `domains` | Fachmodule & Domänen (`/domains`) | `design/assets-source/icons/navigation/domains.svg` | `src/components/icons/navigation/DomainsIcon.astro` | SVG | 24×24 | 343 B |
| `files` | Dateien & Artefakte (`/inbox`) | `design/assets-source/icons/navigation/files.svg` | `src/components/icons/navigation/FilesIcon.astro` | SVG | 24×24 | 261 B |
| `governance` | Governance & Control (`/governance`) | `design/assets-source/icons/navigation/governance.svg` | `src/components/icons/navigation/GovernanceIcon.astro` | SVG | 24×24 | 258 B |
| `system` | System & Setup (`/settings`) | `design/assets-source/icons/navigation/system.svg` | `src/components/icons/navigation/SystemIcon.astro` | SVG | 24×24 | 843 B |
| `fabrika` | Agenten-Werkstatt (`/agenten/fabrika`) | `design/assets-source/icons/navigation/fabrika.svg` | `src/components/icons/navigation/FabrikaIcon.astro` | SVG | 24×24 | 285 B |
| `running` | Living & Running (`/agenten/running`) | `design/assets-source/icons/navigation/running.svg` | `src/components/icons/navigation/RunningIcon.astro` | SVG | 24×24 | 231 B |
| `marblerun` | Agenten-Staffel (`/agenten/marblerun`)| `design/assets-source/icons/navigation/marblerun.svg` | `src/components/icons/navigation/MarblerunIcon.astro` | SVG | 24×24 | 345 B |
| `sessions` | Sessions & Protokolle (`/agenten/sessions`) | `design/assets-source/icons/navigation/sessions.svg` | `src/components/icons/navigation/SessionsIcon.astro` | SVG | 24×24 | 391 B |
| `memory` | Kognitives Memory (`/memory`) | `design/assets-source/icons/navigation/memory.svg` | `src/components/icons/navigation/MemoryIcon.astro` | SVG | 24×24 | 515 B |
| `skills` | Skill- & Tool-Center (`/skills`) | `design/assets-source/icons/navigation/skills.svg` | `src/components/icons/navigation/SkillsIcon.astro` | SVG | 24×24 | 277 B |
| `messages` | Messages / User-Inbox (`/messages`)| `design/assets-source/icons/navigation/messages.svg` | `src/components/icons/navigation/MessagesIcon.astro` | SVG | 24×24 | 262 B |

*Zusätzlich:* Zentraler Icon-Dispatcher [NavIcon.astro](../src/components/icons/navigation/NavIcon.astro) ermöglicht den Aufruf via `<NavIcon name="dashboard" size={20} />`. `Header.astro` verwendet die neun Hauptmenü-Icons sowie die sieben zugeordneten Agenten-/Werkstatt-Icons über `iconId` in `nav_config.json`. Nicht zugeordnete Einträge behalten ihr vorhandenes Symbol.

### Life-Modul-Icons (6 Icons)

Die folgenden sechs Icons ergänzen das Navigationsset für die Life-Unterseiten. Sie verwenden denselben 24×24-Konturstil und werden über denselben Dispatcher gerendert.

| Name | Life-Bereich | SVG-Quellpfad | Astro-Komponente |
| :--- | :--- | :--- | :--- |
| `calendar` | Kalender | `design/assets-source/icons/life/calendar.svg` | `src/components/icons/life/CalendarIcon.astro` |
| `routines` | Routinen | `design/assets-source/icons/life/routines.svg` | `src/components/icons/life/RoutinesIcon.astro` |
| `financial` | Finanzen | `design/assets-source/icons/life/financial.svg` | `src/components/icons/life/FinancialIcon.astro` |
| `balance` | Lebenskreise & Reflexion | `design/assets-source/icons/life/balance.svg` | `src/components/icons/life/BalanceIcon.astro` |
| `health` | Gesundheit | `design/assets-source/icons/life/health.svg` | `src/components/icons/life/HealthIcon.astro` |
| `focus` | Selbstmanagement & Fokus | `design/assets-source/icons/life/focus.svg` | `src/components/icons/life/FocusIcon.astro` |

### Agenten-Rollenicons (12 Icons)

Ein eigenes Rollenicon ergänzt das Porträt in bekannten Blaupausenkarten. Die SVG-Master liegen in `design/assets-source/icons/roles/`, die Runtime-Dateien in `public/assets/agents/icons/` und die Astro-Komponenten in `src/components/icons/roles/`. Die Rollenicons sind wie die Navigations- und Life-Icons konturbasiert, transparent und über `currentColor` thematisierbar.

| Rollen-ID | Runtime-SVG | Astro-Komponente |
| :--- | :--- | :--- |
| `buddha-chat` | `public/assets/agents/icons/buddha-chat.svg` | `BuddhaChatIcon.astro` |
| `always-on-worker` | `public/assets/agents/icons/always-on-worker.svg` | `AlwaysOnWorkerIcon.astro` |
| `connector` | `public/assets/agents/icons/connector.svg` | `ConnectorIcon.astro` |
| `task-solver` | `public/assets/agents/icons/task-solver.svg` | `TaskSolverIcon.astro` |
| `task-writer` | `public/assets/agents/icons/task-writer.svg` | `TaskWriterIcon.astro` |
| `maintainer` | `public/assets/agents/icons/maintainer.svg` | `MaintainerIcon.astro` |
| `operator` | `public/assets/agents/icons/operator.svg` | `OperatorIcon.astro` |
| `ticket-master` | `public/assets/agents/icons/ticket-master.svg` | `TicketMasterIcon.astro` |
| `wartungsagent` | `public/assets/agents/icons/wartungsagent.svg` | `WartungsagentIcon.astro` |
| `system-auditor` | `public/assets/agents/icons/system-auditor.svg` | `SystemAuditorIcon.astro` |
| `law-checker` | `public/assets/agents/icons/law-checker.svg` | `LawCheckerIcon.astro` |
| `researcher` | `public/assets/agents/icons/researcher.svg` | `ResearcherIcon.astro` |

---

## 3. Agenten-Porträts (12 Rollen)

Ein einheitliches Illustrationsset für alle 12 im System und in den Blueprints verankerten Agentenrollen.

### Illustrationssprache & Diversitätskriterien
- **Stil:** Hochwertige, moderne, sympathische redaktionelle Charakter-Illustration (klar konturierte Vektorgrafik mit weichem Licht und Schatten).
- **Rollen-Differenzierung:** Jede Rolle unterscheidet sich über Haltung und funktionale Arbeitsinsignien/Werkzeuge, niemals über hineingeschriebenen Text.
- **Diversität:** Repräsentation verschiedener Geschlechter, Altersstufen (20er bis 60er) und ethnischer Hintergründe ohne Klischees oder Stereotype.
- **Transparenz:** Echter Alpha-Kanal (RGBA) ohne weißen Rand oder dunkle Halos.

### Porträt-Inventar

| Rolle | Technische ID | Insignie & Gegenstand | Master-PNG (1024×1024, RGBA) | Master-Größe | Runtime-WebP (512×512, RGBA) | Runtime-Größe |
| :--- | :--- | :--- | :--- | :---: | :--- | :---: |
| **Buddha Chat** | `buddha-chat` | Dampfende Teetasse, achtsame Geste | `design/assets-source/agents/portraits/buddha-chat.png` | 853 KB | `public/assets/agents/portraits/buddha-chat.webp` | 38 KB |
| **Always-On Worker** | `always-on-worker` | Thermos-Kaffeebecher, Nacht-Hoodie | `design/assets-source/agents/portraits/always-on-worker.png` | 660 KB | `public/assets/agents/portraits/always-on-worker.webp` | 28 KB |
| **Connector** | `connector` | Glasfaser-Schleife & Modular-Patch | `design/assets-source/agents/portraits/connector.png` | 1.006 KB | `public/assets/agents/portraits/connector.webp` | 45 KB |
| **TaskSolver** | `task-solver` | Mechanischer Präzisions-Puzzelwürfel | `design/assets-source/agents/portraits/task-solver.png` | 800 KB | `public/assets/agents/portraits/task-solver.webp` | 39 KB |
| **TaskWriter** | `task-writer` | Digitaler Stylus & Spezifikationsbuch | `design/assets-source/agents/portraits/task-writer.png` | 916 KB | `public/assets/agents/portraits/task-writer.webp` | 37 KB |
| **Maintainer** | `maintainer` | Messing-Drehmomentschlüssel, Schürze | `design/assets-source/agents/portraits/maintainer.png` | 889 KB | `public/assets/agents/portraits/maintainer.webp` | 41 KB |
| **Operator** | `operator` | Headset & Telemetrie-Bedientablet | `design/assets-source/agents/portraits/operator.png` | 617 KB | `public/assets/agents/portraits/operator.webp` | 25 KB |
| **Ticket-Master** | `ticket-master` | Klemmbrett mit farbigen Prioritätsreitern | `design/assets-source/agents/portraits/ticket-master.png` | 584 KB | `public/assets/agents/portraits/ticket-master.webp` | 27 KB |
| **Wartungsagent** | `wartungsagent` | Mikrofasertuch & Diagnoseprisma | `design/assets-source/agents/portraits/wartungsagent.png` | 626 KB | `public/assets/agents/portraits/wartungsagent.webp` | 28 KB |
| **System-Auditor** | `system-auditor` | Metallenes Prüfsiegel, Mandatsweste | `design/assets-source/agents/portraits/system-auditor.png` | 501 KB | `public/assets/agents/portraits/system-auditor.webp` | 20 KB |
| **Law-Checker** | `law-checker` | Gebundenes Gesetzesbuch / Kodex | `design/assets-source/agents/portraits/law-checker.png` | 953 KB | `public/assets/agents/portraits/law-checker.webp` | 46 KB |
| **Researcher** | `researcher` | Feldnotizbuch & Messlupe | `design/assets-source/agents/portraits/researcher.png` | 786 KB | `public/assets/agents/portraits/researcher.webp` | 35 KB |

---

## 4. Hintergrund der Agenten-Werkstatt

Ein handwerkliches, warmes Hintergrundbild einer echten Holzwerkstatt für die Agenten-Werkstatt (`/agenten/fabrika`).

### Bildaufbau & UI-Tauglichkeit
- **Komposition:** Außenbereich reichhaltig bestückt mit handwerklichen Werkzeugen (Hobel, Stecheisen, Holzspäne, Messschieber, Werkzeugwand). Das Bildzentrum auf der massiven Hobelbank ist mit weichem Fokus und niedrigem Kontrast gehalten, damit Karten und Texte mühelos lesbar bleiben.
- **Frei von Störfaktoren:** Keine Personen, keine Logos, keine Schriftzüge.
- **Formate:**
  - Master: `1376×768` Quellauflösung (Seitenverhältnis 1,792:1; leicht breiter als 16:9), verlustfrei als PNG gespeichert.
  - Runtime WebP Ultra: `2560×1440` (interpoliert & geschärft, 280 KB).
  - Runtime WebP 1080p: `1920×1080` (Standard Desktop-HD, 202 KB).

### Hintergrund-Inventar

| Rolle / Einsatzzweck | Ablagepfad | Format | Abmessungen | Dateigröße |
| :--- | :--- | :---: | :---: | :---: |
| **Werkstatt Master** | `design/assets-source/backgrounds/agent-workshop/workshop-master.png` | PNG (RGB) | 1376×768 (1,792:1) | 1.456.904 B (~1,45 MB) |
| **Werkstatt Runtime QHD** | `public/assets/backgrounds/agent-workshop/workshop-bg.webp` | WebP (RGB, Q88) | 2560×1440 | 280.208 B (~280 KB) |
| **Werkstatt Runtime FHD** | `public/assets/backgrounds/agent-workshop/workshop-bg-1080p.webp` | WebP (RGB, Q88) | 1920×1080 | 202.474 B (~202 KB) |

---

## 5. Werkzeug-, Modell- und Prompt-Dokumentation

In Übereinstimmung mit den Transparenz- und Audit-Richtlinien wird die Entstehung der generierten Raster-Bilder hier vollständig offengelegt.

### Verwendete Werkzeuge & Modelle
- **Generierungswerkzeug:** Google DeepMind / Antigravity Subagent-Infrastruktur (`image-generator`)
- **Modell:** Im vorliegenden Produktionsnachweis nicht verifiziert.
- **Generierungsdatum:** 2026-10-04 / 2026-10-05
- **Nachbearbeitung & Alpha-Freistellung:** Python 3.12 mit `OpenCV 4.11` (Fixed-Range FloodFill Boundary Extraction) und `Pillow 12.2` (Lanczos Resampling, WebP Method 6).

### Prompts

#### Werkstatt-Hintergrund
```text
Please generate a photorealistic, warm widescreen 16:9 cinematic background of an authentic woodworking craftsman workshop (Agenten-Werkstatt).
Aesthetic details:
- Solid rustic wooden workbench, fine hand tools (chisels, wooden hand planes, brass calipers, fine wood shavings).
- Soft warm ambient lighting with gentle depth and golden rim light.
- Composition: The periphery has rich craftsman details, but the wide central area has soft focus, low contrast, and calm space specifically designed as a website background so UI cards and text layered on top are perfectly legible.
- STRICT: Absolutely NO text, NO letters, NO logos, NO watermarks, NO people.
```

#### Porträts Batch 1 (Rollen 1–6)
```text
Please generate 6 individual square character bust portrait illustrations.
Universal art style: Consistent, sympathetic, modern, professional editorial character illustration (clean digital vector painting style with subtle soft lighting, crisp contours, warm inviting color palette).
Composition: Centered square bust portrait (head and shoulders to chest level), friendly eye contact, centered in frame.
Background: Solid pure seamless plain white background (#ffffff) with sharp, clean silhouette edges and NO shadows on the background, completely isolated.
STRICT: Absolutely NO text, NO letters, NO labels, NO words, NO logos.

1. buddha-chat: Mindful personal assistant guide. Warm, gentle, friendly smile. East Asian man in his 40s wearing a comfortable soft knit cardigan, holding a small delicate steaming ceramic tea cup with both hands in a peaceful, welcoming posture.
2. always-on-worker: Tireless background daemon / night worker. Young Black woman in her late 20s with neat box braids, wearing a dark comfortable minimalist hoodie, holding a sleek matte thermal coffee mug, calm and deeply focused expression.
3. connector: Integration engineer & bridge builder. Energetic Hispanic man in his late 20s with short dark hair and a warm smile, wearing a denim utility overshirt, holding a neat loop of glowing fiber-optic cable with modular connectors.
4. task-solver: Analytical problem solver and builder. South Asian woman in her 30s with elegant modern glasses, intelligent thoughtful gaze, wearing a tailored vest, rolling up her sleeve, holding a precision mechanical puzzle cube.
5. task-writer: Requirements architect and technical author. Caucasian man in his late 30s with neatly trimmed beard, wearing a crisp linen shirt, holding a modern slim stylus pen and a fine notebook, observant and articulate expression.
6. maintainer: System caretaker and dependable mechanic. Middle-aged Black man with a warm reassuring smile and laugh lines, wearing a sturdy canvas work apron over a check shirt, holding a brass torque wrench.
```

#### Porträts Batch 2 (Rollen 7–12)
```text
Please generate 6 individual square character bust portrait illustrations.
[Universal art style & background constraints as above]

7. operator: Central orchestrator and mission coordinator. Confident East Asian woman in her early 40s with a sharp bob haircut, wearing a minimalist modern blazer, slim communication headset over one ear, holding a thin digital control tablet.
8. ticket-master: Fast triage and incoming queue dispatcher. Young Mediterranean man in his mid 20s with wavy hair and attentive gaze, wearing a dark turtleneck sweater, holding an organized clipboard with neatly sorted colored priority tags.
9. wartungsagent: Code cleanliness and system hygiene specialist. Mature Scandinavian woman in her 50s with silver-streaked hair tied in a neat ponytail, wearing practical navy overalls, holding a soft microfiber polishing cloth and a crystal diagnostic prism.
10. system-auditor: Governance guard and security auditor. African man in his 30s with an upright, vigilant, and fair demeanor, wearing a sleek collarless charcoal jacket, holding an elegant metallic validation seal stamp.
11. law-checker: Legal compliance, policies, and ethics checker. Wise senior Caucasian woman in her 60s with silver curls and reading glasses, wearing a tailored tweed jacket, holding a classic leather-bound policy codex book with bookmark ribbons.
12. researcher: Scientific scout and knowledge explorer. Middle Eastern man in his early 30s with wire-rimmed glasses and curious enthusiastic eyes, wearing a utility field jacket, holding a field notebook and a brass magnifying loupe.
```

---

## 6. Lizenz- & Provenienz-Deklaration

Gemäß den Vorgaben von Lukas und Richtlinie P-001 / Governance:

1. **SVG-Vektor-Icons & Astro-Komponenten:**
   - **Quelle:** Für dieses Projekt erstellt; die Dateien enthalten keine eingebetteten Skripte oder externen Bild-/Font-Abhängigkeiten.
   - **Lizenz:** Bei Aufnahme in das Repository gelten dessen MIT-Lizenzbedingungen.

2. **KI-generierte Bild-Assets (Porträts & Werkstatt-Hintergrund):**
   - **Quelle:** Im Produktionsbericht als KI-generiert beschrieben; konkretes Modell, Erzeugungsbeleg und zum Erzeugungszeitpunkt geltende Anbieterbedingungen sind hier nicht dokumentiert.
   - **Nutzung:** Diese Datei enthält keine Rechtsbewertung und beansprucht weder Gemeinfreiheit noch CC0. Vor einer externen Weiterverbreitung sind Erzeugungsbeleg und die geltenden Anbieterbedingungen zu prüfen.
   - **Sichtprüfung:** Im Kontaktblatt sind keine erkennbaren Markenlogos oder als reale Personen bezeichneten Porträts zu sehen.

---

## 7. Sichtprüfung & Kontaktblatt

Das Kontaktblatt [design-assets-contact-sheet.png](design-assets-contact-sheet.png) (1920×1440 Pixel, PNG) dokumentiert die Sichtprüfung des ursprünglichen Agy-Pakets. Die ergänzten sechs Life-Icons und zwölf Rollenicons sind dort nicht abgebildet; ihre XML-Struktur und Einbindung wurden separat geprüft.
- **Icons:** Vollständig lesbar bei 24px und skaliert; Konturen fehlerfrei.
- **Porträts:** Keine abgeschnittenen Köpfe oder Requisiten; homogene Ausleuchtung; saubere Freistellkanten ohne Zacken; realistische Kachelwirkung auf Karomuster.
- **Hintergrund:** Ruhige zentrale Farbfläche gewährleistet Kontrastnachweis für Textkarten.

### Technischer Prüfstand vom 05.10.2026
- `npm ci` erfolgreich; `npm run build` erfolgreich, 16 statische Seiten erzeugt. Das ist ein lokaler Quell-Build, kein Release und kein BACH-/Ocean-Installationsnachweis.
- Alle 34 SVG-Dateien (16 Navigation, 12 Rollen, sechs Life-Module) parsen als XML, verwenden `currentColor` und enthalten weder Skripte noch externe `href`-Verweise.
- Dateiprüfung: 12 PNG-Master mit 1024×1024 RGBA, 12 WebP-Porträts mit 512×512 RGBA, zwei Runtime-Hintergründe in 2560×1440 und 1920×1080 RGB.
- Der Werkstatt-Master hat 1376×768 Pixel und damit nicht exakt 16:9; beide Runtime-Dateien haben 16:9-Abmessungen. Eine mögliche leichte Verzerrung bei der Umwandlung ist anhand der Bilddateien allein nicht ausgeschlossen.
- `npm audit` meldet für den vorhandenen Abhängigkeitsstand vier Advisories (1 niedrig, 2 hoch, 1 kritisch). Die Behebung des kritischen Astro-Hinweises erfordert laut Audit ein Major-Upgrade; dieses Paket ändert keine Abhängigkeiten.
