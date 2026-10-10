# Konsumentenvertrag

## Ein Build, mehrere Anzeigen

Der statische `dist`-Baum ist bei allen Konsumenten bytegleich. Jeder Backend-Konsument stellt `GET /api/gui/brand` bereit. Die Antwort enthält das Schema `ellmos-system-gui.brand.v1`, validierte Textfelder `label`, `product`, `logo_text`, optional `logo_path` unter demselben Ursprung `/static/branding/*.png|webp` und ein Theme aus `dark`, `light`, `ocean`, `warm`. Die GUI setzt Texte mit `textContent`; bei fehlender Antwort bleibt die neutrale Beschriftung „System GUI“ sichtbar. Die Quelle des Brandings gehört dem Konsumenten und enthält keine Zugangsdaten.

## Backendherkunft

`GET /api/gui/backend-origin` ist eine öffentliche, nichtgeheime Metadatenroute. `mode=server|local` erscheint nur, wenn der Backendadapter seine aktive Datenquelle, Verbindung, minimales Schema und Instanzbindung zur Laufzeit geprüft hat. `declared_mode` und `reason_code` trennen Konfiguration von Beobachtung. Ohne Beleg zeigt die GUI `Backend unbekannt`; bei unerreichbarer Route `Offline · Backend unbekannt`. Ein Offline-Cache darf erst gemeldet werden, wenn er tatsächlich als Datenquelle verwendet und geprüft wird. Browserhost und Bindadresse sind keine Belege. Die BACH-Referenz prüft nur SQLite-Verbindung und zwei Tabellen, nicht Integrität oder Cluster-Synchronität.

## Widget-Fähigkeiten

Die 22 Seiten rufen die REST-Routen des Referenzadapters auf. Der gemeinsame Metadatenvertrag `GET /api/gui/capabilities` verwendet das Schema `ellmos.gui.capabilities.v1`. Jeder Konsument implementiert ihn über seinen eigenen Adapter; diese statische GUI implementiert keine Backendroute.

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


## Zusätzliche Agentenbilder (GUI 0.2.16)

Die drei neuen Zehnerserien verwenden beim Auswählen den bestehenden Bildvertrag:
PNG als data:image/png;base64, höchstens 180000 Bytes und 240000 Zeichen.
Die interne Auswahlkennung wird nicht als neue Presetkennung an den Konsumenten
gesendet. Bestehende Atlas- und Gemini-Presetkennungen bleiben unverändert.
Der Konsument speichert das Bild in avatar beziehungsweise contractus.execution.avatar
und gibt es unverändert zurück. Die gemeinsame Darstellung erkennt diese Bildwerte
beim erneuten Laden und zeigt die gewählte Vorlage und Vorschau. Eine zusätzliche
Backend-Freigabeliste für diese Bilder ist nicht erforderlich. Ein Ocean-Adapter
braucht denselben begrenzten Bildvertrag. Quellbilder bleiben erhalten; die GUI
verwendet ausschließlich die in der Provenienz festgehaltenen Vorschaubilder.

## Inbox und Agenten-Konfiguration

Die Inbox liest GET /api/user-inbox mit Schema bach.user-inbox.v1 und recipient=user.
Der Konsument filtert Empfänger vor Zählung und Pagination. Statusänderungen verwenden
PATCH /api/user-inbox/{id} mit status und expected_status; fremde Empfänger sind nicht
änderbar. Ohne Adapter bleibt die Inbox nicht verfügbar. Chats und Laufprotokolle gehören
in den Agenten-Verlauf; die Inbox bietet keinen allgemeinen Chatversand.

Pausenauslöser 'Keine Pause' wird als pause_after=0 gespeichert; pause_basis bleibt der
kanonische Wert runs oder tasks. Die Zahl der Tool-Runden akzeptiert 0..1000; 0 bedeutet
für Agenten unbegrenzt. Werkzeugfreigaben und explizites Stoppen bleiben eigene Einstellungen.

Die Vorlagenauswahl bei Living und Running ruft den nativen Materialize-Endpunkt auf.
Blueprint- und Konfigurationsversion werden geprüft; Anbieter und konkretes Modell müssen
ausgewählt werden. Die Übernahme erzeugt oder aktualisiert ein Profil und startet keinen
Provider. Pro Blueprint ist derzeit ein nativer Systemsteckplatz vorgesehen; laufende oder
unbestätigte Instanzen können im Dialog nicht ersetzt werden.

Die Nachrichtenansicht liegt unter /user-inbox; die bestehende Datei-Inbox bleibt unter /inbox. Während einer Vorlagenübernahme ist ein Entwurfswechsel gesperrt. Unbestätigte Slots ergeben ausdrücklich einen unvollständigen Laufstatus.

## Native Staffeln
Der Designer erwartet GET /api/marblerun/catalog mit schema=bach.native-sequences.v1, service_instance, configuration_version (SHA-256), runtime_available, chains, agents, skills und runs.
Eine Definition enthält name, title, description, mode=agents|skills, agent_slot und steps mit label, agent_slot, skill_ids und instructions. Anlage: POST /api/marblerun/chains; Änderung: PUT /api/marblerun/chains/{id} mit version und definition. Antworten müssen ok=true und chain mit bestätigter ID, Kennung und neuer Version enthalten. DELETE /api/marblerun/chains/{id}?version=... bestätigt deleted=true und chain_id.
POST /api/marblerun/chains/{id}/run benötigt request_id, version, configuration_version, expected_service_instance und input. Der Start wird ausschließlich nach ausdrücklicher Nutzeraktion gesendet. accepted=true und der korrelierte run bestätigen Zulassung; eine Laufphase allein bestätigt kein fachliches Ergebnis. Bei unbestätigter Antwort bleibt dieselbe Startkennung gebunden. GET /api/marblerun/runs/{id} und POST /api/marblerun/runs/{id}/stop gehören dem Controller. Ocean muss diese Fähigkeit explizit anbinden oder nicht verfügbar melden.

## Domänen-Pins (GUI 0.2.8)
GET /api/domains/pins liefert schema bach.domain-pins.v1, eine 64-stellige SHA256-Version, persisted, total und pins mit stabiler id, name, icon, workbench_url.
POST /api/domains/{id}/pin verlangt {pinned: boolean, version: string}. ACK enthält dieselbe ID/Zustand, success: true und den dauerhaft gespeicherten vollständigen Pinstand. Geräteauth ist erforderlich.
POST /api/domains/pins verlangt {pinned_ids: string[], version: string}; ohne Version wird der frühere unbedingte Listenersatz mit HTTP 428 verweigert.
HTTP 409 meldet eine konkurrierende Version, 423 einen gesperrten/ungeprüften Speicher, 503 einen unlesbaren Speicher. Das Frontend wiederholt keine Mutation automatisch.
Ein GET ohne gespeicherte Datei liefert Voreinstellungen mit persisted: false und erstellt keine Dateien. Bestehende gültige Legacylisten werden bei einem ausdrücklichen Speichervorgang übernommen; unbekannte Metadaten bleiben erhalten.

## Native Dialoge und Taskereignisse (GUI 0.2.9)
GET /api/agent-history/sessions liefert schema bach.chat-sessions.v1, source=session_snapshots, snapshot_type=chat-transcript.v1 sowie sessions, total, offset, limit, has_more und save_limits. Filter: agent_id, archive=all|current|archived; limit 1..100, offset 0..100000. Ohne agent_id werden Profiltranskripte vor der Pagination ausgeschlossen.
GET /api/agent-history/sessions/{id} liefert schema bach.chat-session.v1, source=session_snapshots und sichtbare Nachrichten des gewählten gespeicherten Ausschnitts. Ein Profiltranskript benötigt agent_id und eine weiterhin verifizierte native Profilbindung. Nicht verifizierte Bindungen ergeben HTTP 409. Geräteauth ist erforderlich.
available_excerpt=true beschreibt den vorhandenen Speicherstand: regulär höchstens 40 Nachrichten und 24000 Zeichen pro Nachricht. Frühere abgeschnittene Nachrichten sind nicht wiederherstellbar. Das ist kein vollständiges Nachrichtenjournal. Systemnachrichten und private Reasoning-Felder werden nicht angezeigt.
GET /api/agent-history/tasks liefert schema bach.task-history.v1, source=task_history, events, total, offset, limit und has_more. task_id und status sind kombinierbar; status bezeichnet den aktuellen Aufgabenstatus. Übertragen werden Metadaten und Statusänderungen, keine Akteure oder Inhalte geänderter Beschreibungen.
HTTP 503 bedeutet eine nicht verfügbare Speicherquelle, nicht einen leeren Verlauf. Alle History-Anfragen sind GET; Lesen startet weder Provider noch Worker. Gedächtnisnotizen aus /api/memory/sessions bleiben als eigener Tab erkennbar. Ein Ocean-Konsument benötigt entsprechende verifizierte Adapter.

## Dynamische Worker als Aufgabenziele (GUI 0.2.15)

GET /api/task-assignees ergänzt im bestehenden Schema bach.task-assignees.v1
den Zieltyp worker-profile mit id=worker:<Profilkennung>. slot_id und
binding.assigned_slot enthalten die native Profilkennung ohne Präfix.
binding.assigned_to ist der konfigurierte Anbieter in Großbuchstaben;
binding.required_model bleibt das konfigurierte Modell, auch openrouter/free.
Die GUI übernimmt diese Bindung und assignment_configuration_version beim
Anlegen oder Ändern einer Aufgabe. Sie startet dadurch keinen Worker.

assignable verlangt einen verifizierten nativen Laufzeitstand, ein nicht
pausiertes oder abgelaufenes Profil und task_manage in seinen Werkzeugrechten.
Unbestätigte, fehlerhafte und private Staffelprofile sind nicht auswählbar.
Der Konsument prüft den globalen Konfigurationsstand nach der Statusabfrage
und unter seinem Konfigurationslock bis zum Task-Commit. HTTP 409 verlangt
eine neue Auswahl; HTTP 422 meldet ein inzwischen ungeeignetes Profil.
Task-Leases bleiben für die tatsächliche Übernahme erforderlich. Ocean muss
diesen Zieltyp aus seinem eigenen Controller anbinden oder nicht anbieten.

## Hintergrundworker: Dienst und tatsächliche Arbeit

GET /api/system/workers liefert weiter bach.workers.status.v1. Jeder Worker
meldet runtime_verified, worker_active und running als boolesche native
Laufzeitwerte. worker_active bestätigt einen lebenden Hintergrundthread;
running bestätigt eine aktive Taskbindung dieses Threads. active_task_id
ist nur für die aktuell gebundene Task gesetzt. Gespeicherte status- oder
task_id-Werte sind allein kein Arbeitsnachweis. Ein wartender kontinuierlicher
Worker bleibt Living und besitzt Pause/Stop; ein weiterer Start ist gesperrt.

has_task_prompt meldet ausschließlich das Vorhandensein eines gespeicherten
Zusatzauftrags. Promptinhalte gehören nicht in die allgemeine Statusprojektion.
current_activity zeigt auch Fehler und Wartegründe. Fehlende Laufzeitfelder
werden als unbestätigt dargestellt; Ocean muss die Werte aus seinem eigenen
Controller liefern.
