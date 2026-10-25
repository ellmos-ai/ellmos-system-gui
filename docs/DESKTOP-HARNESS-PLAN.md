# Desktop-Harness-Plan

**Status:** technische Planung; Umsetzung und Plattformabnahme offen
**Task:** 2053
**Zusammenhang:** bestehende Tasks 2025, 2033 und 2052; Thumbnailfolge 2054
**Erstellt/aktualisiert:** 2026-10-18
**Geprüfter GUI-Quellstand:** `origin/main` bei `4bc28c7bb3d179395403c6625edc6057071b66d6`
**Prüfungsgrenze:** statische Code- und Vertragsprüfung; keine Anwendungstests, Builds, Laufzeit- oder Betriebssystemdienst-Prüfungen ausgeführt

## Öffentliche Begriffe und Ressourcenmodell

Ein **Desktop-Harness** ist die Desktop-Shell für eine bestehende Weboberfläche. **Attach** bedeutet, dass die Oberfläche eine ausdrücklich ausgewählte, bereits erreichbare Backend-Instanz verbindet. Attach startet weder Backend noch Scheduler, Agent, Modell, Cloud-Dienst oder Job. **Daemon** bezeichnet den langlebigen Backend-Prozess für Zeitplanung und Ausführung; **Worker** ist eine einzelne, vom Backend verwaltete Ausführung. Die GUI zeigt deren Zustand an, besitzt aber nicht deren Lebenszyklus.

**Steckplätze und Slots** bezeichnen ausschließlich die lokale Modell- und Ressourcensteuerung, einschließlich Fackel. Sie sind weder Agentenidentität noch Cloud-Kontingent. **Systemagenten** sind vom System mitgelieferte Blueprints; **Useragents** sind vom Nutzer angelegte Blueprints. Diese Herkunftskategorie ist unabhängig von Ausführungsmodell und lokaler Slotbelegung. Agenten-Blueprints werden wie Skills und Prompts versioniert. Jeder Lauf verweist auf eine unveränderliche Blueprint-Version; Modell und lokale Ressourcenbelegung werden getrennt am Lauf dokumentiert. Externe Agenten belegen keine lokalen Slots, solange sie extern laufen. Ein tatsächlich aktivierter lokaler Fallback benötigt vorübergehend den passenden lokalen Slot und dessen Ressourcen. Es gibt keinen eigenen Cloud-Slot.

## Review und Quellenstand

Die Prüfung wurde im eigenen Worktree gegen den oben genannten `origin/main`-Stand durchgeführt. Sie umfasste die Repository-Struktur, die Frontend-Verträge, die API-Aufrufstellen und die in BACHs `origin/main` vorhandenen Integrationspfade. Der Review ist keine GitHub-Freigabe, Laufzeit- oder Geräteabnahme. Ein unversionierter Entwurf im Hauptklon wurde als Arbeitsgrundlage gelesen und dort nicht verändert.

## Ausgangslage und Ziel

Die gemeinsame GUI ist eine statische Astro-Oberfläche (ellmos-system-gui/astro.config.mjs). Mehrere Seiten und Komponenten rufen APIs über relative Pfade wie `/api/...` auf, darunter `src/components/Header.astro` und `src/pages/agenten/running.astro`; weitere Aufrufstellen liegen in Seiten- und Browser-Skripten. Im geprüften GUI-Stand existieren weder `src-tauri/` noch eine `tauri.conf.json`, ein `Cargo.toml` oder ein nativer IPC-Kern. Ein zentraler Desktop-API-Client ist ebenfalls noch nicht vorhanden. Das setzt für einen gebündelten Desktop-Build zuerst einen gemeinsamen Client mit konfigurierbarer Backend-Basisadresse sowie eine festgelegte CORS- und Authentifizierungsstrategie voraus.

BACH enthält bereits Scheduler-, Daemon- und Worker-Adapter, unter anderem system/hub/scheduler.py, system/hub/scheduler_provider.py, system/gui/daemon_service.py, system/gui/daemon_identity.py und system/gui/api/worker_status_adapter.py. Diese vorhandenen Stellen sind Integrationspunkte. Ihre Existenz belegt weder ein vollständiges Desktop-Produkt noch die nachfolgenden Laufzeitgarantien. Der Desktop-Plan erweitert keinen zweiten Scheduler und führt keine parallele Job-Autorität ein.

BACH und Open-Ocean konsumieren denselben versionierten statischen GUI-Build. Die GUI besitzt weder die TaskDB noch die Autorität über Agenten, Leases, Daemonen oder Worker. BACH liefert Referenzadapter; Open-Ocean benötigt eigene kompatible Adapter, eigene Authentifizierung und einen eigenen Capability-Readback. Ein Desktop-Harness darf diese Konsumentengrenzen nicht durch eine lokale Kopie von `src/` oder durch einen stillen lokalen Fallback umgehen.

Ziel ist ein **Tauri 2 Desktop-Harness in einer ersten Remote-Origin-Stufe**. Die Weboberfläche lädt von einem konfigurierten und identitätsgeprüften Backend-Origin. Für Netzwerkverbindungen ist die verschlüsselte, authentifizierte Verbindung vorzusehen; bewusst konfigurierte Loopback-Verbindungen werden gesondert behandelt. Ein Loopback-Tunnel beweist nicht die Identität des Zielhosts. Die Webview erhält keine native IPC-Capability und keine privilegierten Rust-Befehle. Originwechsel und Weiterleitungen bleiben begrenzt; Zugangsdaten werden weder in URLs noch ins Frontend-Bundle geschrieben. Rust verwaltet ausschließlich Tray- und Shell-Lifecycle. Persistente Jobs und Worker bleiben vollständig im Backend. Backend-Zugangsdaten oder Provider-Schlüssel gelangen nicht in Frontend-Bundles.

Attach verbindet nur mit einem erreichbaren Backend. Bei Nichterreichbarkeit bleibt die Oberfläche getrennt und zeigt einen verständlichen Zustand; sie startet weder lokale Prozesse noch Cloud-Läufe als stillen Fallback. Der Scheduler beziehungsweise Daemon wird separat und ausdrücklich vom Host betrieben.

## Verbindliche Implementierungsanforderungen

### P1: einheitliche Job-Lease mit Fencing

Zeitgesteuerte Ausführung und „Jetzt ausführen“ müssen dieselbe atomare Job-Lease verwenden. Der gemeinsame Besitz verhindert konkurrierende Starts bei Fälligkeit, manueller Auslösung und Neustart. Lease-Ablauf allein beweist kein Prozessende: vor Übernahme muss die alte Ausführung nachweisbar terminal oder kontrolliert beendet sein. Bei unbekanntem alten Zustand bleibt der Job gesperrt. Bereits ausgeführte Tools oder externe Nebenwirkungen dürfen nicht blind erneut ausgeführt werden. Eine monotone Fence-Generation muss verhindern, dass ein veralteter Worker nach Lease-Verlust Status oder Ergebnisse überschreibt. Ohne gültige Lease darf kein Job starten.

### P1: Backend besitzt Daemon und Worker

Vorhandene Scheduler-/Daemon-Verträge werden wiederverwendet. Im geprüften GUI-Modus läuft owner_kind=gui als Serverthread; vor Nutzung als unabhängige Aufsicht muss ein eigener, vom Betriebssystem verwalteter Owner am tatsächlichen Ausführungshost nachgewiesen werden. Bestehende Wartungsowner und Host-Units werden zuvor erfasst, damit keine Doppelinstallation entsteht. Die GUI ist weder Daemon-Thread noch Dienstmanager. Schließen, Absturz oder Upgrade der GUI beendet keine gültigen Backend-Jobs. Eine Backend-Verbindung startet keinen Dienst.

### P1: begrenzte Prozessausführung

Das Backend startet jeden Prozesslauf in einer eigenen, eindeutig zugeordneten Prozessgrenze. Timeout und Abbruch beenden ausschließlich die zu diesem Lauf gehörenden Prozesse und Nachkommen und warten auf deren terminalen Zustand. Unter Windows sind eigene Job Objects mit Ownerhandle, kontrollierter Zuordnung vor Kindstarts und definiertem Kill-on-close zu prüfen. Unter Linux sind pro Lauf geeignete systemd-Scopes/cgroups mit kontrollierter Gruppenbeendigung vorzusehen, wo verfügbar. macOS nutzt launchd für persistente Owner; Adhoc-Prozessgruppen brauchen zusätzlich unabhängige Aufsicht und Reaping. Eine Prozessgruppe allein garantiert bei Ownercrash keine automatische Bereinigung. Kooperative Threadausführung benötigt Abbruch-/Terminalbelege; eine nackte Python-Threadbeendigung ist kein verlässlicher Rückweg. Ein globales „kill all“ oder ein nicht zugeordneter Tree-Kill ist ausgeschlossen. Eine Desktop-App verwaltet keine lokale PID eines Remote-Hosts. Die Shell besitzt nur später ausdrücklich gestartete temporäre lokale Sidecars; deren Grenzen sind von den persistenten Backend-Workern getrennt.

### P1: versionierter Ausführungsvertrag

Ein gemeinsamer Vertrag bach.worker-execution.v1 unterscheidet mindestens execution_kind=thread und execution_kind=process. Jeder Lauf benötigt einen korrelierten Startbeleg mit start_request_id, generation, service_instance und Konfigurationsversion. Ein Thread-Lauf hat keine eigene Betriebssystem-PID; sein Beleg ist worker_thread_started und kein Nachweis eines eigenen Prozesses. Ein Prozess-Lauf benötigt zusätzlich eine prüfbare Prozessidentität mit PID und Startzeit beziehungsweise Birth-Identity und dem tatsächlichen Ausführungshost. Legacy-Starts ohne korrelierte Belege sind für den Desktoppfad gesperrt. Status- und Ergebnis-Readbacks prüfen die zum Lauf gehörende Fence-Generation und Identität.

Der Vertrag hält Job-ID, Lauf-ID, Blueprint-ID und unveränderliche Blueprint-Version getrennt von Ausführungsmodell und lokaler Slotbelegung. Externe Agenten erzeugen keinen Cloud-Slot.

### P1: zentraler API-Zugang vor Bundle-Build

Vor einem gebündelten Frontend-Build werden alle API-Aufrufe über einen gemeinsamen Client geführt. Dieser löst Backend-Basisadresse, Fehlerbehandlung und Authentifizierung zentral auf. Ein Origin-Wechsel braucht eine explizite CORS-Allowlist und einen dokumentierten Geräte-/Session-Token-Fluss. Keine Zugangsdaten werden in das Bundle geschrieben. Erst nach diesen Verträgen wird ein gebündelter Build als Option freigegeben.

## P2: Betriebs- und Prozesshygiene

- Prozessidentität berücksichtigt PID-Wiederverwendung durch Startzeit/Birth-Identity und Runtime-Pfad. Toleranzen für Zeitstempel werden je Zielplattform festgelegt und getestet.
- Der Scheduler bekommt eine ausdrückliche Suspend-/Wake- und Nachholregel. Aufwachen darf nicht mehrere gleichartige Jobs unkontrolliert parallel auslösen.
- Der Windows-Zombie-Killer bleibt auf eng erlaubte, einzeln geprüfte verwaiste Prozesse beschränkt. Er ist keine Job-Aufsicht für BACH und beendet keine Prozessbäume.
- Das vorhandene --parent-pid-Verhalten koppelt einen Worker an die Tray-Elterninstanz: endet das Tray, endet der Worker. Dieses Verhalten ist keine Grundlage für persistente Backend-Worker.
- Erkennung eines laufenden Daemons und GUI-Verbindungsstatus sind getrennte Zustände. Eine fehlende Verbindung startet keinen zweiten Daemon.

## Umsetzungsphasen

1. **Verträge festlegen:** Lease/Fence, bach.worker-execution.v1, unveränderliche Blueprint-Versionen und getrennte lokale Ressourcenbelegung dokumentieren.
2. **Backend absichern:** Gemeinsame Lease für Scheduler und „Jetzt ausführen“, Fence-Prüfung bei Resultat-/Statusschreibvorgängen und pro Lauf begrenzte Prozessausführung implementieren.
3. **Daemon aus GUI lösen:** vorhandenen Daemon über einen geeigneten nativen Betriebssystemdienst beziehungsweise Startauftrag betreiben; Installations- und Aktualisierungspfad wiederverwenden, sofern er zum bestehenden Modul gehört.
4. **Remote-Origin-Shell:** Tauri 2 ohne IPC-Capabilities; Rust-Core nur für Tray und Shell-Lifecycle. Attach bleibt eine explizite Verbindung.
5. **API-Client und optionales Bundle:** zuerst zentraler API-Client, Backend-Basisadresse, CORS-Allowlist und Authentifizierungsfluss; danach erst gebündelte Frontend-Variante evaluieren.
6. **Plattformabnahme:** die folgende Matrix auf Windows, macOS und Linux ausführen. Dokumentation und Messergebnisse getrennt halten.

## Abnahmekriterien je Plattform

| Plattform | Dienst und Prozessgrenze | GUI- und Scheduler-Abnahme |
|---|---|---|
| Windows | Eigener nativer Dienst/Startauftrag; pro Prozesslauf eine zugeordnete Job-Object-Grenze; PID-Wiederverwendung wird erkannt. | GUI-Ende beendet keinen Backend-Job. Fälliger Job und gleichzeitiges „Jetzt ausführen“ erzeugen höchstens einen Lauf. Suspend/Wake folgt der dokumentierten Nachholregel. |
| macOS | Eigener launchd-Dienst/Startauftrag; Prozessgruppen- oder äquivalente Laufgrenze; Prozessidentität wird erneut gelesen. | Gleiche Lease-/Fence- und Attach-Abnahmen wie Windows; Tray-Ende startet oder stoppt keine Backend-Ausführung. |
| Linux | Eigener systemd-Dienst/Startauftrag, soweit im Zielsystem vorhanden; Prozessgruppen- oder äquivalente Laufgrenze. | Gleiche Lease-/Fence- und Attach-Abnahmen wie Windows; Prozessabbruch betrifft ausschließlich den eigenen Lauf. |

Für alle Plattformen gilt zusätzlich: Remote-Origin-Aufruf und API-Basis sind nachvollziehbar; ein getrennter Backend-Zustand startet nichts; Frontend-Code hat keine Tauri-IPC-Capabilities; Blueprint-Version und tatsächliche lokale Modell-/Ressourcenbelegung sind in jedem Lauf getrennt erkennbar. Konkurrierende, wiederholte und nach Neustart fortgesetzte Läufe müssen mit gezielten Regressionstests belegt werden. Diese Tests sind zukünftige Abnahmeschritte und wurden für diesen Entwurf nicht ausgeführt.

## Prüfungsgrenze und offene Umsetzung

Die zugrunde liegende Sichtung war statisch. Sie belegt keine erfolgreiche Installation, Dienstregistrierung, Prozessbaum-Beendigung, CORS-Konfiguration, Token-Übergabe oder Plattformabnahme. Der Entwurf ändert keinen Code und startet keine Dienste, Modelle oder Cloud-Läufe. Konkrete Dienstkonten, Installer-Aufrufe, Paketierung und Authentifizierungsdetails bleiben vor der Implementierung zu spezifizieren und auf jeder Zielplattform zu verifizieren.

## Verknüpfte Bibliotheks- und Oberflächenplanung

- #1951: Herkunft Systemagenten/Useragents und unveränderliche Agenten-/Blueprintrevisionen; #2025: Governance bereits in der Vorlage, wirksame Regeln vor Start und Resume.
- #2011/#2027/#2028: lokale Modellsteckplätze, Slotbelegung und tatsächliche Fackelanteile; keine Hardware-Slots für externe Ausführung.
- #1964: Skillfassungen nach eingestellter Systemsprache, sonst Englisch; Sprachvarianten derselben Skill-ID deduplizieren und die gewählte Version bis zum Reader/Editor durchreichen.
- #2054: Bildauswahl ohne gesamte Inline-Galerie im initialen JavaScript; geeignete Thumbnails, Laden bei Sichtbarkeit und getrennte Messung von Netzwerk, Bundle und Renderer-Speicher.
- #2052: vorhandene Installer mit Plan/Apply/Verify/Rollback weiterverwenden; getrennte App-/Backendaktualisierung, keine impliziten Cloudstarts oder Doppelowner.

## Primärquellen für die Umsetzung

- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/): Remote-Webviews erhalten hier keine nativen Rechte; Berechtigungen ausdrücklich konfigurieren, keine breit registrierten Custom Commands für Webinhalte.
- [Tauri Frontend-Konfiguration](https://v2.tauri.app/start/frontend/): statischer Web-Build und API-Origin sind getrennte Integrationsfragen.
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects): Prozessgruppen als OS-verwalteter Besitz mit festgelegtem Beendigungsverhalten.
- [Python subprocess](https://docs.python.org/3/library/subprocess.html): Timeout des direkten Kindprozesses ersetzt keine kontrollierte Baumaufsicht.

Diese Quellen ersetzen die native Prüfung der konkreten Plattform- und Dienstkonfiguration nicht.
