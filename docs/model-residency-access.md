# Lokale Modellangebote und Agentenzugriff
Session: 01a164ec-6c99-7ae0-8363-4981e58c2954 · Task #2011 · 23.10.2026

Die gemeinsame Oberfläche trennt zwei Ansichten derselben nativen Konfiguration:
Modellangebote mit ihren Zugriffszuordnungen und Agentenprofile mit ihren lokalen Modellzugriffen.
Eine Zuordnung reserviert keinen eigenen Hardwareplatz. Mehrere Agenten können dasselbe Modellangebot referenzieren.
Profile ohne lokale Zuordnung werden angezeigt; daraus folgt weder ein Fehler noch ein belegtes externes Ziel.

Beide Ansichten verwenden dieselbe gelesene Host- und Konfigurationsversion. Bindungs-IDs, Quellen-CAS, API-Pfade, Schreibgates und unabhängiges Speicherrücklesen bleiben erhalten. Der Ansichtswechsel sendet keine Anfrage und verändert keine Konfiguration. Verwaiste Zuordnungen bleiben sichtbar; Bearbeitung ihres fehlenden Profils bleibt gesperrt.

## Grenzen der vorhandenen Daten

Der native Konfigurationssnapshot meldet derzeit unbekannte Residenz, keine gemessenen Gewichts-/KV-/RAM-Anteile und keinen Kapazitätsnachweis. Die angezeigte Host-/Modellgrenze ist eine Konfigurationsangabe. Sie beweist keine aktuelle Ressourcenadmission, tatsächliche Parallelität, freie RAM-Reserve oder laufende Inferenz. Der Modellkatalog beschreibt Fähigkeiten; auch er ist kein Residenznachweis. Vorgemerkte Haupt-/Fallbackzugriffe belegen keinen tatsächlich aktivierten Fallback. Vollständig externe Inferenz erfordert keinen lokalen Modellplatz.

Der volle Task bleibt offen: gemeinsame RAM-/Residenz-/KV-/Kontextbudgets und Systemreserve, tatsächliche Fairness-/Prioritätsadmission, alle nativen Caller sowie gekoppelte Ressourcen-/Host-/Geräteabnahme. Dieser Quellenschritt ändert die Ansicht und verwendet bestehende Mutationen; er startet keine Modelle, Worker oder Dienste und migriert keine produktive Konfiguration.
