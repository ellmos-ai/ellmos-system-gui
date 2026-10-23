# Aufgabenansicht: Übernahme und Regeln

Session: 01a164ec-6c99-7ae0-8363-4981e58c2954 · codex@ASUS-GEI · 2026-10-23
Task: #2212 · Teilbezug: #2254/#2258

## Gemeinsame Quelle

Diese Lieferung ergänzt ausschließlich `ellmos-system-gui`. Die fünf
Erklärungsgruppen der vorhandenen #2254-Vorarbeit werden im Aufgaben-Detail
verwendet: Lease, Status/Abhängigkeit, Abschlussregeln/Ausführungsrechte,
Modell/Zuständigkeit und Versionsbindung/Rückgabe.
Die alte BACH-web-Kopie wird nicht als Produkt weiterentwickelt.

Vorarbeit: `ellmos-ai/bach`, Commit `93ad113755015d067dacd80c52452cb9de9a95dd`,
Datei `system/gui/web/src/lib/task-hindrances.js`,
SHA-256 `0fd805906476b8395feff43f7f7f3b9686913bdf8fb62a6eed7478a0b6248380`.
Die Struktur wird übernommen und an die tatsächlichen nativen Verträge
angepasst; es handelt sich nicht um eine bytegleiche Kopie. Die bisherige
WIP-Datei und ihr Branch bleiben unverändert.

## Tatsächlich gelesene Quellen

Nach Laden der Aufgabendetails werden unabhängig und parallel
`GET /api/tasks/{id}/lease` sowie `GET /api/tasks/{id}/worker-policy` gelesen.
Fehler einer Quelle lassen die andere Quelle und die übrigen Aufgabendetails
nutzbar. Beide Routen sind im gemeinsamen Lesepfadmanifest optional gebunden.
Der vorhandene Geräte-Fetchwrapper bleibt zuständig. Es werden keine privaten
Lease-IDs angefordert oder übertragen, keine Tokens gespeichert und keine
Schreib-, Claim-, Renew-, Start- oder Konfigurationsendpunkte aufgerufen.

Native Referenz: BACH `015550b351c953f8944a1b54deeb71218784889f`,
`system/gui/server.py` (`get_task`, `read_task_lease`),
`system/gui/api/worker_policy.py` und
`system/hub/_services/worker_policy_settings.py` (`_task_snapshot`).
Die Lease-GET-Implementierung kann das bestehende additive Schema sicherstellen;
diese Lieferung behauptet daher keinen SQLite-Query-only-Pfad hinter dieser API.

## Keine erfundene Zulassung

Die zusätzliche Antwort muss dieselbe Task-ID und Inhaltsversion wie die
geöffneten Details nennen. Die Lease muss außerdem denselben Status zeigen,
plausible native Zeitstempel und bei einer belegten Lease einen Halter haben.
Bei Widerspruch wird keine gemeinsame Momentaufnahme behauptet. Ein nativ als
belegt geführter Legacy-Claim mit ausdrücklich unbekanntem Ablauf bleibt als
Belegung sichtbar; sein Ende wird als nicht bestätigt ausgewiesen.

`own` fehlt im nativen Lease-GET ohne passende private Lease-ID. Daraus wird
weder ein fremdes Gerät noch die Identität des betrachtenden Workers abgeleitet.
Ein Halter wird als Belegung zum Zeitpunkt der Backendbeobachtung gezeigt.
Die Anzeige ist kein laufender Lease-Countdown und verlängert keine Lease.
Historisches `claimed_by` ist keine Quelle für den aktuellen Halter.

Die Task-Policy muss `bach.task-worker-policy-override.v1`, den Vertrag
`worker-review-policy.v1alpha1` sowie die erwarteten typisierten Felder liefern.
Diese Konfiguration enthält Abschluss-/Reviewregeln, keine Werkzeugrechte und
keinen ausgewerteten Abschlussentscheid. Ihre Konfigurationsbasis wird nicht
als Herkunft jedes einzelnen wirksamen Feldes ausgegeben.

Gespeicherte Modell-, Slot- und Zuständigkeitsangaben werden nicht zu harten
Zulassungsregeln umgedeutet. Ohne ausführenden Worker und dessen wirksame Flags
ist diese Prüfung nicht möglich. Aus Task-/Leaseversionen wird auch kein
unveränderter Rückgabeversuch konstruiert. Fehlende Felder bleiben nicht verfügbar.
Ein offener Status, Kandidatenlistenpräsenz oder fehlende Hindernisse sind kein
Claim-Pass. Providerfehler oder Operatorfreigaben werden nicht erfunden.

## Darstellung und Lebenszyklus

Der Detailabruf und die vorhandenen Ergebnis-/Korrektur-/Abnahmewege bleiben
unverändert. Die zusätzliche Beobachtung blockiert diese Wege nicht.
Generations- und Objektprüfung verhindern, dass späte Antworten Daten einer
anderen oder inzwischen geschlossenen Aufgabe überschreiben.
Alle dynamischen Inhalte werden ausschließlich als Text in DOM-Knoten gesetzt.
Die Darstellung nutzt die vorhandenen Themevariablen und ein responsives Raster.

## Offene Gesamtabnahme

Diese Anzeige liefert native Erklärungsdaten am richtigen gemeinsamen Quellort.
Sie ersetzt nicht die erweiterte tatsächliche Worker-Auswahlvorschau aus
PR480/#2260 und keine Integration/Abnahme aller Teilaufgaben von #2212.
Ausführungsrechte, konkrete workergebundene Ausschlussgründe, Rückgabehistorie,
Providerzustände, vollständige globale/Task-Bedienung und Geräte-/Browser-/
Betriebsabnahme bleiben getrennt zu belegen. Bestehende PR89 und fremde
WIP-/Reviewaufgaben werden weder ersetzt noch als akzeptiert markiert.
Keine neuen oder manuellen Anwendungstests/Builds aus dieser Quelländerung.
