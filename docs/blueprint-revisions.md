# Aufgezeichnete Vorlagenversionen in der Agenten-Werkstatt

Session: 01a164ec-6c99-7ae0-8363-4981e58c2954 · codex@ASUS-GEI · 2026-10-23
Task: #1951 · Backendvertrag: `bach.blueprint-revisions.v1`

## Bedienung

Die Schaltfläche **Versionen** einer Vorlage öffnet deren aufgezeichnete
Revisionen. Zwei Auswahlen dienen der Einzelansicht und dem Vergleich.
**Ältere Versionen laden** holt jeweils bis zu 25 weitere Aufzeichnungen.
Die gespeicherte Definition und der Vergleich werden als Text angezeigt;
Inhalte werden nicht als HTML interpretiert. Eine Kürzung des Vergleichs
wird ausdrücklich angezeigt. Die Einzeldefinition bleibt vollständig lesbar.

**Auswahl als neue Version wiederherstellen** verlangt eine ausdrückliche
Bestätigung. Die neue Version wird anschließend über die reguläre
Blueprintliste zurückgelesen. Systemvorlagen bleiben geschützt.
Bestehende Agenten und laufende Instanzen behalten ihre Konfiguration.
Die Wiederherstellung startet keinen Worker und erneuert keine Instanz.

## Vertrag und Fehlverhalten

Die Funktion verlangt den Backendmarker `blueprint_revision_contract` aus
BACH PR481 / `3d8876ddbbadaf0926f5b3ec7a07d7f7a8b2491e`.
Ohne passenden Adapter bleibt sie mit einem Hinweis nicht verfügbar.
Die zusätzlichen Lesepfade und der Restorepfad sind im gemeinsamen
`public/page-reads.v1.json` als optionale, dynamische Aufrufe eingetragen.
Der übrige Vorlagenkatalog bleibt mit älteren Konsumenten verfügbar.

Antworten werden auf Schema, Identität, Version, Hashform und Pagination
geprüft. Einzeldefinition und Vergleich müssen zu den aufgezeichneten
Hashes der geladenen Historie passen. Das Backend prüft die gespeicherten
Snapshotbytes; die GUI behauptet keine zusätzliche kryptografische Prüfung.
Historienseiten müssen dieselbe aktuelle Vorlagenversion nennen.
Bei einem Versionswechsel wird eine Wiederherstellung bis zum Neuladen
verweigert. Ein Restore sendet ausschließlich die zuvor angezeigte erwartete
aktuelle Version; Konflikte führen zu keiner automatischen Wiederholung.
Ein HTTP-Fehler gibt keine internen Backenddetails an die Oberfläche weiter.

Asynchrone Antworten eines inzwischen geschlossenen oder ersetzten Dialogs
werden verworfen. Während einer ausdrücklich bestätigten Wiederherstellung
wird das Schließen bis zur Antwort gesperrt. Bei unbestätigtem Readback
bleibt die neue Version als möglicherweise bereits gespeichert erkennbar;
ein erneuter Restore wird bis zum Neuladen gesperrt.

Vor Einführung nicht aufgezeichnete Änderungen werden nicht erfunden.
Die API kann Historien nach Löschen der aktuellen Vorlage weiterhin lesen;
die Werkstatt bietet derzeit keinen eigenen Katalog gelöschter Vorlagen.

## Grenzen der Lieferung

Dieser Nachtrag ergänzt die zuvor in der BACH-Dokumentation von PR481 noch
offen genannte GUI-Bedienung für Historie, Vergleich und Restore.
Keine vollständige #1951-Abnahme: externe Persona-/Prompt-/Skillreferenzen,
weitere Team-/Staffelfunktionen, gekoppelte Geräte-/Browser-/Runtimeabnahme,
reguläre Integration und Deployment bleiben getrennte offene Schritte.
Keine neuen Testfälle oder manuellen Anwendungstests/Builds aus dieser
Quelllieferung. Syntax, Lesepfadbindung, unabhängiger Quellreview und
gegebenenfalls die automatisch ausgelöste CI werden separat protokolliert.
