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

## Bauen und native Pakete

Voraussetzungen: Rusttoolchain und die plattformspezifischen
[Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/).

```text
cargo build --manifest-path src-tauri/Cargo.toml --release --locked
```

Dies baut ausschließlich die Desktopbinary, startet sie aber nicht. Ein bereits
geöffnetes Terminal kann den Build ausführen; automatisierte Windowslauncher
müssen wie die übrigen Projektwerkzeuge konsolenfrei starten und ihre eigenen
Buildprozesse beaufsichtigen. Der reine Cargo-Bau installiert keine Toolchain.

Für installierbare Kandidaten verwendet die CI zusätzlich den exakt auf2.12.4
gebundenen Tauri-CLI aus `.github/desktop-toolchain`. Sein eigener npm-Lock enthält
die Registry-Integritätswerte aller Plattformpakete. Die Web-GUI-Abhängigkeiten
bleiben unverändert. Lokaler ausdrücklicher Paketbau, beispielsweise für Windows:

```text
npm ci --prefix .github/desktop-toolchain --ignore-scripts --no-audit --no-fund
node .github/desktop-toolchain/node_modules/@tauri-apps/cli/tauri.js build --ci --no-sign --bundles nsis -- --locked
```

Der Paketbau verwendet zusätzlich Node22 und die Bauvoraussetzungen des jeweiligen
Zielsystems. Er startet weder die erzeugte App noch den Installer. Der Tauri-CLI
ist ein gesondertes Bauwerkzeug unter MIT/Apache-2.0, kein Backend oder Sidecar.

Die CI baut den exakten PR-Head beziehungsweise auslösenden Main-Commit. Sie erzeugt
unter Windows einen NSIS-Installer für das aktuelle Benutzerkonto, unter macOS eine
`.app` samt `.dmg` und unter Linux `.deb` und `.AppImage`. Architektur und tatsächliche
Dateien stehen im Plattformreceipt; damit ist keine zusätzliche Architektur belegt.
Der Windows-Installer enthält den WebView2-Bootstrapper. Fehlt die WebView2-Runtime,
benötigt deren Einrichtung eine Internetverbindung. Die App erhält dadurch keine
Berechtigung, Backenddienste oder Modelle zu installieren oder zu starten.

Vor dem Paketbau werden ausschließlich frühere Bundleausgaben des Buildcaches
entfernt. Ein frischer Kandidat muss alle für die Plattform angeforderten Formate
liefern. Die `.app` wird zusätzlich als Tararchiv verpackt, damit Ausführungsrechte
und interne Symlinks beim Artefakttransport erhalten bleiben. Externe App-Symlinks,
falsche App-ID/-Version und ein fehlender ausführbarer Einstieg brechen die Sammlung
ab. Appbundle und reine Binary erhalten eigene Hashes, da die native Paketierung
die Appbinary verändern kann.

Je Plattform stellt die CI ein Artefakt `desktop-consumer-<OS>-<Commit>` mit Binary,
nativen Paketen, Projektlizenz und `desktop-artifact.json` bereit. Der Beleg hält
Quellcommit, Repository, CI-Lauf/-Versuch, Plattform, Architektur, Rust-/CLI-Version,
beide Dependencylock-Hashes, Tauri-Konfigurationshash sowie Dateigröße und SHA-256
aller enthaltenen Lieferdateien fest. Änderungen der beiden Locks während des Baus
werden abgewiesen. Die Windows-CI prüft weiterhin direkt den PE-Header der App auf
GUI-Subsystem2.

Der heruntergeladene Beleg und die Binary müssen zum selben vollständig
erfolgreichen CI-Lauf und exakten Quellcommit gehören; der Dateihash muss passen.
Ein Hash aus demselben Paket ist ein Integritätsbeleg, keine unabhängige Signatur.
Die Programme und Installer werden beim Erstellen des Artefakts nicht gestartet.
Die Buildoption `--no-sign` erzeugt ausdrücklich Kandidaten ohne Publishersignatur
oder Notarisierung. Der Receiptwert `acceptance.installer=false` kennzeichnet die
noch fehlende Installerabnahme; vorhandene Formate stehen getrennt unter `bundles`.
Diese CI-Artefakte bleiben 14Tage verfügbar. `src-tauri/Cargo.lock` bindet den
gemeinsamen Rust-Dependencygraphen im Quellstand. Codesignierung/Notarisierung,
wirkliche Installation, Update/Rückweg, Datenerhalt bei Deinstallation und
Store-Veröffentlichung sind noch offen. Es gibt keinen automatischen Release,
Store-Upload oder Start der Kandidaten.

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
[Paketbau und Signierung](https://v2.tauri.app/distribute/),
[CLI-Optionen](https://v2.tauri.app/reference/cli/),
[Windows-Installer](https://v2.tauri.app/distribute/windows-installer/).
