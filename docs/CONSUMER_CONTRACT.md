# Konsumentenvertrag

## Ein Build, mehrere Anzeigen

Der statische `dist`-Baum ist bei allen Konsumenten bytegleich. Jeder Backend-Konsument stellt `GET /api/gui/brand` bereit. Die Antwort enthält das Schema `ellmos-system-gui.brand.v1`, validierte Textfelder `label`, `product`, `logo_text`, optional `logo_path` unter demselben Ursprung `/static/branding/*.png|webp` und ein Theme aus `dark`, `light`, `ocean`, `warm`. Die GUI setzt Texte mit `textContent`; bei fehlender Antwort bleibt die neutrale Beschriftung „System GUI“ sichtbar. Die Quelle des Brandings gehört dem Konsumenten und enthält keine Zugangsdaten.

## Backendherkunft

`GET /api/gui/backend-origin` ist eine öffentliche, nichtgeheime Metadatenroute. `mode=server|local` erscheint nur, wenn der Backendadapter seine aktive Datenquelle, Verbindung, minimales Schema und Instanzbindung zur Laufzeit geprüft hat. `declared_mode` und `reason_code` trennen Konfiguration von Beobachtung. Ohne Beleg zeigt die GUI `Backend unbekannt`; bei unerreichbarer Route `Offline · Backend unbekannt`. Ein Offline-Cache darf erst gemeldet werden, wenn er tatsächlich als Datenquelle verwendet und geprüft wird. Browserhost und Bindadresse sind keine Belege. Die BACH-Referenz prüft nur SQLite-Verbindung und zwei Tabellen, nicht Integrität oder Cluster-Synchronität.

## Widget-Fähigkeiten

Die 21 Seiten rufen die REST-Routen des Referenzadapters auf. Der gemeinsame Metadatenvertrag `GET /api/gui/capabilities` verwendet das Schema `ellmos.gui.capabilities.v1`. Jeder Konsument implementiert ihn über seinen eigenen Adapter; diese statische GUI implementiert keine Backendroute.

- `system` enthält System-ID und Adapterversion; `observed_at` eine UTC-Zeit.
- `gui` enthält Status, Quellcommit und Archiv-SHA-256. `installed` ist erst nach vollständiger Prüfung des Dist-Manifests und aller Dateihashes zulässig.
- `modules` bleibt das bestehende Objekt je Modul-ID mit `adapter_registered`, `available`, `runtime_verified` und `reason_code`. Das additive Array `module_sources` enthält ID, Version, Quellcommit und `verified`. Eine Deklaration ohne geprüfte Provenienz setzt `verified` nicht auf wahr.
- `pages` enthält ID, Pfad, Status, Voraussetzungen, fehlende Bausteine und TODO. Bei bloßer Implementierung ist der Status `configured`, bei fehlendem Adapter `unavailable`; das ist keine Browser- oder Laufzeitabnahme.
- `endpoints` enthält Methode, Pfad, Art (`read`, `write`, `action`), `available`, Provider-ID/-Version, Authentifizierung und Grund. `available` bezeichnet eine implementierte und passend konfigurierte Adapterroute. Für diese Prüfung gelten `runtime_verified: false` und `verification_scope: adapter`; ein echter Lauf benötigt einen eigenen Laufzeitbeleg.
- Der Authentifizierungsvertrag unterscheidet `provider-session`, `device-token` und `none`. Ocean verwendet seine eigene Sessiongrenze; BACH seinen Gerätevertrag. Schlüssel gehören nicht in die Metadatenantwort.

Eine Dist-Installation und eine verfügbare Route belegen keinen laufenden Agenten. Fehlende Widgets zeigen ihren Zweck, fehlende Bausteine und offene Schritte ohne Erfolgsbehauptung. Native Slots, Runs und Tasks bleiben in einem Ocean-Adapter ohne angebundenen Laufzeitdienst nicht verfügbar.

Die Frontend-Voraussetzungen des aktuellen Imports sind in [BACH_FRONTEND_IMPORT_2026-10-08.md](BACH_FRONTEND_IMPORT_2026-10-08.md) beschrieben. Die Workeransicht erwartet zusätzlich das bestehende Referenzschema `bach.workers.status.v1`; Profilzustände und bestätigte Laufreceipts werden getrennt dargestellt.

Trithon, Muschelgrund und Salt haben eigene Architekturverträge. Die BACH-Teiladapter für Dispatch und Receipt-Projektion sind kein vollständiger Nachweis ihres Systemzustands. Die Systemkarten zeigen ohne Modulprobe `unbekannt`. Die Fackel bleibt bei Agenten als Compute-Vorrang; eine Prozess-ID allein belegt keine laufende Aufgabenarbeit.

## Task-Zuweisung

Die beiden Task-Formulare verwenden `GET /api/task-assignees` mit Schema `bach.task-assignees.v1`, Quelle `native_control_and_blueprints`, `configuration_version` und `targets`. Ein auswählbares Ziel liefert die kanonische `binding` aus `assigned_slot`, `assigned_to` und `required_model`. Das Frontend sendet diese Felder zusammen mit `assignment_configuration_version`; das Backend prüft die neue Bindung und die Konfigurationsversion. Auch ein bewusstes Entfernen eines Slots benötigt die aktuelle Version. Der Versionswert ist ein Anfrageparameter und kein gespeichertes Task-Feld.

Unbekannte vorhandene Slots werden als nicht verfügbar angezeigt und beim Bearbeiten beibehalten. Ein Blueprint ohne Instanz ist nicht auswählbar. Die Auswahl startet keinen Worker. Die bestehende manuelle Zuweisung über `/api/assignees` bleibt möglich; bei fehlendem Katalog gibt es keine neue Slot-Bindung. Nach einem Versionskonflikt muss der Benutzer den Katalog neu laden und erneut auswählen.

## Release und Konsum

Ein Release enthält `dist/` mit `dist-manifest.json` sowie `LICENSE` und ein Archiv, dessen SHA-256 öffentlich dokumentiert wird. Release-Vorprüfung, Manifestgenerator und Packager verweigern veränderte oder ungetrackte Quellstände. Ein Vorprüfungsbeleg bindet den Build an denselben sauberen Git-Commit; der Packager verweigert einen Build aus einem anderen Commit. BACH und Open-Ocean pinnen **Repo-Commit plus Archiv-SHA-256** und prüfen beide vor Installation. Sie halten keine unabhängig bearbeiteten Kopien von `src/`. Veränderte Konsumenten-Checkouts sind nur mit erhaltenem Vorabbild und einzeln geprüften Installationshashes zu aktualisieren. Open-Ocean aktiviert Panels erst nach eigenem Adapter-/Capability-Readback.


## Software und Ocean

Die Software-Seite /skills/software liest ausschließlich den Anwendungskatalog
über GET /api/capabilities/software. Das bestehende Inventarschema
bach.capability-inventory.v1 enthält kind=software, catalog=software-applications
und items[].evidence=software_release_catalog. Die Quelle ist das vorhandene
.SOFTWARE/releases.json beziehungsweise die ausdrücklich konfigurierte
Anwendungswurzel BACH_APPLICATION_ROOTS (JSON-Liste absoluter Pfade).
publications[].declared_status ist der Registerstand; live_verified=false und
installed=null bleiben ohne zusätzliche Abnahme bestehen. Private Notizen,
Launchbefehle und Anwendungsdaten werden nicht übertragen.

Die bisherigen Repository-Quellen sind unter /skills/ocean und
GET /api/capabilities/ocean erreichbar: kind=ocean, catalog=ocean-host-sources.
BACH_OCEAN_ROOTS konfiguriert diese Quellen; das bisherige BACH_SOFTWARE_ROOTS
bleibt nur als kompatibler Rückfall für diese Repository-Ansicht erhalten.
Ocean-Konsumenten müssen beide Adapter getrennt implementieren. Fehlt die
Katalogkennung, zeigt die GUI die fehlende Anbindung statt Repository-Einträge
als Anwendungen auszugeben.
