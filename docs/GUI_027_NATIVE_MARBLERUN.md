# GUI 0.2.7 – native Staffeln
Der gemeinsame MarbleRun-Designer verwendet jetzt die geprüften BACH-Endpunkte statt der Beispielkette.

- Agentenfolgen und Skillfolgen anlegen, zuordnen, verschieben und mit Versionsprüfung speichern.
- Neue Staffel aus Living & Running und bestehende Staffel über edit öffnen.
- Anbieter und Modell der ausgewählten Agenten vor einem ausdrücklichen Start anzeigen.
- Kettenstart bindet Kettenversion, Living-Konfiguration, Controller und eine wiederverwendbare Startkennung.
- Unbestätigte Starts behalten Auftrag und Startkennung; ein anderer Start ist bis zur Klärung gesperrt.
- Mutationen sperren während der Anfrage Entwurfswechsel, weitere Aktionen und das Schließen mit Escape.
- Task-IDs, tatsächliche Laufphasen, fachliche Ergebnisse und kooperative Stops aus dem nativen Controller darstellen.
- Ohne passenden Katalog oder Laufzeitadapter bleibt die Funktion ausdrücklich nicht verfügbar. Ein Ocean-Adapter braucht denselben Vertrag; das Frontend erzeugt keine eigene Laufzeit.

Quelle: BACH-Commit 64aee7be6dc01bda1b56eb5a86dbd71ac21c5ab2, system/gui/web. SOURCE_PROVENANCE.json hält Originalhashes und angepasste Importhashes getrennt.
Produktive Mac-Abnahme und abschließender unabhängiger Review sind noch offen.
