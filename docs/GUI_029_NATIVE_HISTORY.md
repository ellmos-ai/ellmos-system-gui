# GUI 0.2.9 – gespeicherte Dialoge und Taskereignisse

Die Seite /agenten/sessions liest native Transkriptausschnitte mit Profil- und Archivfiltern sowie den dauerhaften Taskverlauf mit kombinierbaren Aufgaben- und Statusfiltern. Der Running-Bereich verlinkt diese Ansicht. Dialoge öffnen in einer lesbaren Detailansicht; referenzierte Aufgaben führen zum Taskboard.

## Speichergrenze

Die bestehende SessionStore-Persistenz begrenzt reguläre Transkripte auf 40 Nachrichten und 24000 Zeichen pro Nachricht. Die Ansicht stellt vorhandene Ausschnitte und Archive dar. Ein vollständiges künftiges Nachrichtenjournal ist damit noch nicht umgesetzt.

## Quellen und Bedienung

- Alle Verlaufsanfragen verwenden GET und starten keine Agenten.
- Profilbindung, Geräteauth, Quellenkennung und Seitenzählung werden geprüft.
- Fehlende Quellen erscheinen als nicht verfügbar, nicht als leerer Verlauf.
- Nachrichtentexte werden als Text gerendert. Systemnachrichten und private Reasoning-Felder bleiben ausgeschlossen.
- Gedächtniszusammenfassungen sind gesondert benannt.

## Auslieferungsstatus

Dieser Quellstand ist noch nicht veröffentlicht oder auf dem Mac aktiviert. Release, unabhängiges Review und Live-Abnahme stehen aus.
