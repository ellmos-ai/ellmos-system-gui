# ellmos System GUI

Eine gemeinsame Astro-5-Quelle für die **BACH/Ocean GUI**. BACH und Ocean verwenden denselben statischen Build und liefern ihre eigene geprüfte API-Anbindung und Laufzeitmarke. Der Anzeigename, das Logo und das Theme werden pro Konsument über `GET /api/gui/brand` geladen.

Die bisherige Astro-Quelle stammte aus dem bereinigten öffentlichen BACH-Stand `4b007a51776592ff2426511c585360b6ce58897f`, ergänzt um die unabhängig geprüften lokalen Korrekturcommits `85f9b5edaf278c9899c5f59897108578afd6b8d3` und `0d5a1e39893a3f7180df3c450df46e7cbf2b774f`. Die alte BACH-Git-Historie wurde nicht importiert.

## Bauen

```sh
npm ci
npm run build:release
python scripts/package_release.py
```

`dist/` enthält danach 16 HTML-Seiten und die zugehörigen Assets. `dist-manifest.json` enthält SHA-256-Werte aller Dateien und den Quellcommit. Das Python-Skript prüft alle Einträge und erstellt unter `release/` ein ZIP-Archiv mit festen Zeitstempeln. BACH und Ocean müssen ein freigegebenes Release-Archiv und seinen SHA-256-Wert pinnen und vor der Aktivierung prüfen.

## Status und API

Der BACH-Adapter ist die derzeitige Referenz für bestehende REST-Routen. Die Ocean-Adapter fehlen für viele der 16 Seiten. Ein installierter HTML-Baum beweist daher keine nutzbaren Module. [Der Konsumentenvertrag](docs/CONSUMER_CONTRACT.md) beschreibt die erforderlichen öffentlichen Metadaten und die Grenzen der Widget-Anbindung.

Die eigenständige **Universal GUI** wird separat aus dem bisherigen `ellmos-unified-gui`-Modul entwickelt. Dieses Repository enthält deren Jinja-/HTMX-Quelle nicht.

Lizenz: MIT.
