# GUI 0.2.6 – Bedienung und Prozessansicht

## Änderungen

- Running zeigt tatsächliche Aktivität; Verlauf steht vor den standardmäßig eingeklappten Systemslots.
- Fertige Agenten und Teams sowie einzelne Staffeln sind einklappbar.
- „Vorlage auswählen“ öffnet die Zusammenstellung bei Living & Running mit Anbieter und Modell. Die Übernahme startet keinen Worker.
- „Keine Pause“ wird als pause_after=0 gespeichert. Tool-Runden sind von 0 bis 1000 wählbar; 0 bedeutet unbegrenzt.
- „Agenten-Werkstatt“ bezeichnet die Vorlagenbibliothek. Das vorhandene Gemini-Werkstattbild wird als Hintergrund ausprobiert.
- Inbox enthält Nachrichten an den Nutzer; fremde Empfänger sind vor Zählung und Pagination ausgeschlossen. Der bisherige Messages-Pfad wird vom BACH-Konsumenten umgeleitet.
- Die Memory-Map beschreibt Prozesse und Teilprozesse. Sie ist einklappbar, verwendet zusammengehörige Farbfamilien und lädt Mermaid lokal. Der Ist-Abgleich ist separat dokumentiert.
- „Aufgabe zuweisen“ öffnet das Task-Formular mit einer frisch geprüften Slot-Bindung. Der Nutzer legt die Aufgabe ausdrücklich an.

## Prüfbelege und Grenzen

- Gemeinsame Node-Suite: 102 Prüfungen bestanden.
- BACH-Regressionen für Worker-Konfiguration und Task-Aktionen: 50 bestanden.
- Isolierte native Prüfungen: Core- und Worker-Grenzen 0/101/1000 angenommen, 1001 abgewiesen; pause_after=0 gespeichert.
- Inbox-Fixture: Empfängergrenze vor Pagination, fremde Statusänderung 404 und veraltete Statusänderung 409.
- Tatsächlicher Edge-Browser mit synthetischen Antworten: 1000 gültig, 1001 ungültig, deaktivierte Pausenfelder, korrektes Speichern und Vorlagenübernahme ohne Navigation oder Providerstart; keine JavaScript-Fehler.
- Mermaid wurde im tatsächlichen Browser in hellem und dunklem Theme als SVG gerendert. Das bestätigt Darstellung, keine vollständige kognitive Laufzeitarchitektur.

Mac-Installation und Providerabnahme erfordern eigene Readbacks. Ein Blueprint besitzt derzeit höchstens eine native Instanz; laufende oder unbestätigte Instanzen werden im Dialog nicht ersetzt.
Der separate MarbleRun-Designer und die vollständige Verlaufsansicht bleiben für das nächste Arbeitspaket offen.
