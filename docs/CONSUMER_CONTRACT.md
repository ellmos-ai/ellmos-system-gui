# Konsumentenvertrag

## Ein Build, mehrere Anzeigen

Der statische `dist`-Baum ist bei allen Konsumenten bytegleich. Jeder Backend-Konsument stellt `GET /api/gui/brand` bereit. Die Antwort enthält das Schema `ellmos-system-gui.brand.v1`, validierte Textfelder `label`, `product`, `logo_text`, optional `logo_path` unter demselben Ursprung `/static/branding/*.png|webp` und ein Theme aus `dark`, `light`, `ocean`, `warm`. Die GUI setzt Texte mit `textContent`; bei fehlender Antwort bleibt die neutrale Beschriftung „System GUI“ sichtbar. Die Quelle des Brandings gehört dem Konsumenten und enthält keine Zugangsdaten.

## Backendherkunft

`GET /api/gui/backend-origin` ist eine öffentliche, nichtgeheime Metadatenroute. `mode=server|local` erscheint nur, wenn der Backendadapter seine aktive Datenquelle, Verbindung, minimales Schema und Instanzbindung zur Laufzeit geprüft hat. `declared_mode` und `reason_code` trennen Konfiguration von Beobachtung. Ohne Beleg zeigt die GUI `Backend unbekannt`; bei unerreichbarer Route `Offline · Backend unbekannt`. Ein Offline-Cache darf erst gemeldet werden, wenn er tatsächlich als Datenquelle verwendet und geprüft wird. Browserhost und Bindadresse sind keine Belege. Die BACH-Referenz prüft nur SQLite-Verbindung und zwei Tabellen, nicht Integrität oder Cluster-Synchronität.

## Widget-Fähigkeiten

Die 16 Seiten rufen weitere REST-Routen direkt auf. Vor Ocean-Aktivierung ist ein versionierter `GET /api/gui/capabilities`-Vertrag mit tatsächlich installierten Modulen, Adapterversion, Beobachtungszeit und geprüfter Verfügbarkeit je Widget erforderlich. Diese Route ist **noch nicht implementiert**. Die bisherigen Ocean-Module erfüllen die BACH-spezifischen Endpunkte nicht vollständig; eine bloße Dist-Installation darf deshalb nicht als vollständige Ocean-GUI gelten. Fehlende Widgets bleiben sichtbar mit geplantem Zweck, fehlenden Bausteinen und konkretem TODO, ohne Erfolgs- oder Livebehauptung.

Trithon, Muschelgrund und Salt haben eigene Architekturverträge. Die BACH-Teiladapter für Dispatch und Receipt-Projektion sind kein vollständiger Nachweis ihres Systemzustands. Die Systemkarten zeigen ohne Modulprobe `unbekannt`. Die Fackel bleibt bei Agenten als Compute-Vorrang; eine Prozess-ID allein belegt keine laufende Aufgabenarbeit.

## Release und Konsum

Ein Release enthält `dist/` mit `dist-manifest.json` und ein Archiv, dessen SHA-256 öffentlich dokumentiert wird. BACH und Open-Ocean pinnen **Repo-Commit plus Archiv-SHA-256** und prüfen beide vor Installation. Sie halten keine unabhängig bearbeiteten Kopien von `src/`. BACHs Mac-Checkout enthält fremde Änderungen und alte Overlay-Dateien; dort sind nur einzeln vorabbild- und hashgeprüfte Installationen zulässig. Open-Ocean aktiviert Panels erst nach eigenem Adapter-/Capability-Readback.
