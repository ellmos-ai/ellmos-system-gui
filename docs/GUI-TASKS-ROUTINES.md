# GUI-Aufgaben und Routinen

## Aufgaben

Die Aufgabenliste zeigt den Status als kompaktes Badge innerhalb der Tabellenzeile. Auch `Blockiert`, `Zur Prüfung` und unbekannte Zustände bleiben auswählbare Listeneinträge; kein Status erzeugt eine blockierende Vollflächenanzeige.

Wird eine Aufgabe geöffnet, erscheint ihr Detailbereich als responsives Seitenpanel. Auf schmalen Ansichten fällt das Panel unter die Liste zurück. Die Detaildaten, Ergebnisprüfung und Bearbeitung bleiben an den aktuellen Task-Readbacks gebunden.

## Routinen & Jobs

`/routinen` ist die gemeinsame Oberfläche für geplante Routinen und Jobs. Die Liste hat Filter für Herkunft und Typ sowie sichtbare Spalten für:

- Planung,
- nächsten Lauf,
- letzten Lauf,
- Run-Schalter,
- Wartungsherkunft und
- eine ausdrücklich bestätigte Aktion.

Persönliche Routinen kommen ausschließlich aus der Life-Quelle `/api/routines`. Ihr bestätigter Abschluss nutzt den bestehenden `/api/routines/{id}/complete`-Vertrag. Ein Run-Umschalter wird nicht aktiviert, solange dafür kein eigener Adaptervertrag vorliegt.

BACH, Ocean und Module sind als getrennte Herkünfte vorgesehen. Fehlt der jeweilige Backend-Adapter, zeigt die Oberfläche `Adapter nicht verfügbar` und erzeugt keine Beispieljobs oder erfundenen Laufzeiten. Die bisherige persönliche Ansicht unter `/life?tab=routinen` bleibt als Bearbeitungsweg erhalten.
