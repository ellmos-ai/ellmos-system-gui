# Gemeinsame Desktop-App

Task2337. Tauri2-Verpackung im vorhandenen Modul `ellmos-system-gui`.
Implementierungskandidat; Geräteabnahme, Installation und produktive Aktivierung
sind offen. Der statische GUI-Release und die Desktop-App haben getrennte Belege.

## Verwendung und Lebenszyklus

Die lokale Anschlussseite nimmt eine ausdrücklich eingegebene Backendadresse
entgegen. HTTPS verwendet normale Zertifikatsprüfung. HTTP ist ausschließlich
für ausdrücklich bestätigte Loopbackadressen erlaubt. URL-Zugangsdaten,
Suchparameter und Fragmente werden beim Anschluss abgewiesen.

Die App lädt die tatsächlich von BACH oder Ocean ausgelieferte Oberfläche.
`desktop/` enthält nur die Anschlussseite. Es enthält keine zweite fachliche GUI
und keinen kopierten Astro-Stand. Der bestehende Server stellt die Anmeldung,
Adapter und Hintergrundausführung bereit. Ocean-Sitzungscookies verbleiben im
Remote-Webview; BACH verwendet seinen vorhandenen Geräteanmeldeweg. Die Shell
überträgt weder Tokens noch Cookies zwischen den beiden Fenstern.

`Verbindung → Verbindung wechseln …` schließt die bisherige Anzeige und öffnet
die Anschlussseite. `Ansicht neu laden` lädt den gewählten Origin erneut.
Schließen oder Absturz der App startet oder beendet keine Backenddienste,
Agenten, Modelle oder Jobs. Es gibt keine Sidecars, Shell-Commands oder
Dienstinstallation. Eine zweite Appinstanz fokussiert das vorhandene Fenster.
Popupfenster werden abgewiesen; Navigation bleibt am exakten gewählten Origin.

## Berechtigungsgrenze und Belege

Nur das gebündelte Fenster `connection` erhält die einzelne native Berechtigung
`allow-attach`. Der asynchrone Rust-Handler prüft zusätzlich Label und lokalen
Dokument-Origin. Das Remote-Fenster `backend` erhält keine Capabilities oder
Remote-IPC-Freigabe. Keine globale Fenster-Wildcard ist konfiguriert.

Ein begrenzter GET auf `/api/gui/capabilities` folgt keinen Redirects. Das Schema
`ellmos.gui.capabilities.v1` belegt nur Vertragskompatibilität. HTTP401/403 oder
ein Redirect innerhalb desselben Origins lassen die vorhandene Anmeldung zu.
Transportprüfung, Vertragsbeobachtung und Identität der fachlichen Backendinstanz
bleiben getrennt. Der Anschlussbeleg `ellmos-system-gui.desktop-attach.v1`
behauptet weder `instance_verified` noch einen Backendstart. Die Herkunftsanzeige
der gemeinsamen GUI bleibt für den nativen Datenquellennachweis maßgeblich.

Die Windowsbinary verwendet auch im Debugbau das GUI-Subsystem. Der Rust-Kern
startet keine Git-, Konsolen-, Backend- oder Workerprozesse. Die Webview verwendet
die Rendererprozesse ihrer Plattformruntime; diese sind von den persistenten
Backendjobs getrennt. Der CI-Bau prüft das GUI-Subsystem zusätzlich direkt im
erzeugten PE-Header.

## Bauen

Voraussetzungen: Rusttoolchain und die plattformspezifischen
[Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/).

```text
cargo build --manifest-path src-tauri/Cargo.toml --release --locked
```

Dies baut ausschließlich die Desktopbinary, startet sie aber nicht. Ein bereits
geöffnetes Terminal kann den Build ausführen; automatisierte Windowslauncher
müssen wie die übrigen Projektwerkzeuge konsolenfrei starten und ihre eigenen
Buildprozesse beaufsichtigen. Es wird keine Toolchain automatisch installiert.
Die CI baut auf Windows, macOS und Linux den exakten PR-Head beziehungsweise den
auslösenden Main-Commit. Sie stellt den aufgelösten Dependencylock und je Plattform
ein Artefakt `desktop-consumer-<OS>-<Commit>` mit der kompilierten Binary bereit.
`desktop-artifact.json` hält Quellcommit, Repository, CI-Lauf, Plattform, Architektur,
Dependencylock-Hash sowie Dateigröße und SHA-256 der Binary fest. Die Windows-CI
prüft weiterhin direkt den PE-Header auf GUI-Subsystem2.

Der heruntergeladene Beleg und die Binary müssen zum selben vollständig
erfolgreichen CI-Lauf und exakten Quellcommit gehören; der Dateihash muss passen.
Ein Hash aus demselben Paket ist ein Integritätsbeleg, keine unabhängige Signatur.
Die Programme wurden beim Erstellen des Artefakts nicht gestartet. Unter macOS
und Linux ist nach dem Entpacken gegebenenfalls das Ausführungsrecht zu setzen.
Diese CI-Artefakte bleiben 14Tage verfügbar. `src-tauri/Cargo.lock` bindet den
gemeinsamen Dependencygraphen im Quellstand. Die Artefakte sind keine Installer;
Codesignierung, Installation, Update und Store-Veröffentlichung sind noch offen.

## Offene vollständige Abnahme

Die Task2337-Anforderungen bleiben erhalten: tatsächlicher Start und Reconnect,
Login für beide Consumer, GUI-Ende und Renderercrash, Sleep/Wake,
Backend-/Workerbesitz, vorhandener Lease-/Fence-/Ausführungsreceiptvertrag,
Netzwerkfehler und Recovery, sichere Installation, Update und Rückweg sowie
Windows-/Mac-/Linux-Geräteabnahme. Ein erfolgreicher Compilerlauf ersetzt diese
Abnahmen nicht. Die Sourceänderung enthält keine neu ausgeführten manuellen Tests
und startet keinen Worker oder Backenddienst.

Quellen: [Tauri-Capabilities](https://v2.tauri.app/security/capabilities/),
[asynchrone Webview-Erzeugung](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html),
[Frontend-Vertrag](https://v2.tauri.app/start/frontend/).
