# Prüfung des Memory-Soll-Modells

Quellenprüfung: 9. Oktober 2026. Laufzeitabfrage: 2026-10-08T22:12:18.485650+00:00.
Die kognitive Darstellung ist eine Architekturmetapher, kein wissenschaftlich belegtes Funktionsmodell eines LLM.

## Darstellungsauftrag

Der Nutzer beschreibt Prozesse und Teilprozesse. Die zeichnerische Trennung bedeutet keine Pflicht zu getrennten Komponenten. Bedarfserkennung, Auswahl, Regelprüfung und Zustellung können im selben Hooker implementiert werden. Der bisherige Text hatte daraus fälschlich eine physische oder logische Modultrennung abgeleitet. Die Map wird als Prozessansicht korrigiert.

## Befunde

| Aussage | Beobachtung | Konsequenz |
|---|---|---|
| Hooker besitzen keine Kontrolllogik | MemoryHooker filtert und begrenzt Kontext. WorkflowHooker enthält evaluate_action_guard und evaluate_stop_gate sowie deny/ask/allow-Entscheidungen. | Aussage korrigiert. |
| Hooks sind der einzige dynamische Kontexteingang | ChatRuntime baut Systemkontext pro Turn; Nutzereingaben und Werkzeugresultate gelangen ebenfalls in die Nachrichten. | Exklusivitätsbehauptung entfernt. |
| Hooker sind in BACH aktiv | Auf dem Mac sind MemoryHooker 0.3.0 und WorkflowHooker 0.2.1 installiert. Der In-process-Memory-Seam besitzt einen Audit-Trail. | Installation, historischer Injektionsbeleg und aktueller Eventaufruf unterscheiden. |
| Eventkonfiguration entspricht dem Chat-Loop | Gemessene chat_hooks.json enthält nur Stop. Die geprüfte ChatRuntime ruft nur PostToolUse auf. | Eventanschluss ist offen; kein aktueller Stop-Guard-Beleg. |
| Memory-Zahlen sind live | cognitive-state bestätigt bach_memory_tables, available, error=null. | Belegt ausschließlich gemessene Tabellenzahlen, keine übrigen Architekturbausteine. |
| Allgemeine Memory-Injektion gilt für jeden Agenten | profile_binding umgeht _get_bach_context und _get_memory_hook_context. | Profilgebundene Agenten brauchen eine ausdrücklich geprüfte eigene Kontextstrategie. |

## Quellen

- BACH main 3e430c2dcd099999ff7e7fdc93717711d9ce0f02: system/hub/memory_hook_provider.py, system/hub/_services/chat/chat_runtime.py und hooks.py.
- MemoryHooker: memoryhooker/triggers.py und output_policy.py.
- WorkflowHooker: workflowhooker/gates.py und decisions.py.
- Audit-Metadaten auf dem Lead-Host: letzte beobachtete Injektion ts=2026-10-08T23:17:11, mode=remember+search, chars=838. Der Audit-Zeitstempel enthält keine Zeitzone; er wird nicht zu UTC umgedeutet. Keine Memory-Inhalte wurden in diesen Bericht übernommen.
- Lokale Codex-Hookkonfiguration ist ein eigener Anschluss: SessionStart → MemoryHooker, UserPromptSubmit → WorkflowHooker. Die aktuelle Sitzung erhielt einen MemoryHooker-Hinweis. Das belegt keinen identischen BACH-Anschluss.

## Umsetzungsempfehlung

1. Pro Anbieter und Laufzeit eine Tabelle der unterstützten Events führen.
2. Eventkonfiguration gegen tatsächlich vorhandene Aufrufe abgleichen; ungenutzte Stop-Konfiguration nicht als Durchsetzung melden.
3. Injektion mit Anschluss, Session, Ereignis und beobachteter Ausgabe belegen; Konfiguration oder Paketinstallation reichen dafür nicht.
4. Guard-Entscheidungen und Zusatzkontext als unterschiedliche Teilprozesse und Rückgabewerte darstellen; sie dürfen im selben Modul liegen. hooks.fire liest bisher additionalContext und schluckt Fehler; das setzt noch keinen blockierenden Aktionsguard durch.
5. Erst nach einem gezielten Anschlussnachweis einen Live-Statusadapter in die GUI aufnehmen. Bis dahin bleibt die Map ausdrücklich Soll-Modell.

## Oberfläche

Die Map lässt sich jetzt per Tastatur und Maus ein- und ausklappen. Die unteren Inspektoren bleiben eigenständig bedienbar. Hooker- und Exklusivitätsaussagen wurden anhand der Quellen korrigiert.
