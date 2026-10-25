# GUI-Routen: Rückfall ins alte Design

Stand: 25.10.2026 · Task #2468

## Messung

Die Anbindungsmatrix vom 25.10.2026 misst im älteren Navigationsstand zwölf Pfade mit vierzehn Einträgen als alte BACH-Vorlage. `/routinen` erschien zweimal und `/gesundheit` zweimal. Zusätzlich waren `/daemon` ohne `?tab=chains` und der Header-Schnellzugriff `/kontakte` nicht durch die gemeinsame Seite geschützt.

Im aktuellen gemeinsamen Stand ist `/routinen` durch Task #2477 eine eigene gemeinsame Astro-Seite. Die verbleibenden alten Zielpfade werden im Modul `src/lib/navigation-route-inventory.mjs` geführt. Jeder Eintrag hat eine erzeugte Astro-Seite mit `BachLayout` und `LegacyRouteFallback.astro`; der Hinweis benennt den Pfad, die Ursache und Task #2468.

`/daemon` ist query-gesteuert: Ohne `?tab=chains` erscheint der Hinweis. Mit `?tab=chains` bleibt der vorhandene Kettenbereich erreichbar. Daraus folgt kein Beleg für einen aktiven Daemon oder Scheduler.

## Build-Schranke

`scripts/verify-navigation-routes.mjs` liest beide Navigation-Presets und den Header-Schnellzugriff. Vor jedem normalen Build und vor `build:release` prüft es, dass jeder Pfad entweder eine gemeinsame Astro-Seite oder einen dokumentierten Fallback besitzt. Fehlende Einträge beenden den Build mit Pfadliste und Task-Kontext.

Der Prüfschritt verhindert nicht jede Änderung in einem externen Consumer. Er stellt sicher, dass diese gemeinsame GUI keinen Navigationseintrag ohne gemeinsame Hülle oder ausdrücklich sichtbaren Rückfall ausliefert.

## Abgrenzung

Die Fallback-Seiten zeigen keine alte Vorlage, keine erfundenen Laufzustände und keine Backenddaten. Sie sind ein sichtbarer Übergabepunkt zur offenen Aufgabe. Consumer-Adapter für BACH und Ocean bleiben außerhalb dieses Repositories.
