# Gemeinsame Agententrigger

Stand: 04.11.2026.

## SOLL

Routinen und Deine Agenten verwalten dieselben Zeit- und Ereignisdefinitionen
mit stabiler ID, Versionsprüfung und dem externen Scheduler als einziger
Speicher- und Ausführungsautorität. Kalendertermine verwenden dieselbe Definition.

## IST dieser Änderung

Beide Seiten verwenden dieselbe Komponente und denselben API-Client für
`/api/agent-triggers`. Anlegen, Bearbeiten, Aktivieren und Löschen lesen die
gespeicherte Definition unabhängig zurück. Ein Versionskonflikt wiederholt
keinen Schreibzugriff und erhält den Entwurf. Neue Definitionen sind zunächst
deaktiviert. Speichern startet keinen Worker; Ereignisse werden hier nicht
manuell als bestätigte Aufgabenabschlüsse ausgegeben.

Fehlende Provider und Geräteanmeldung bleiben sichtbar. Die Formulare verwenden
aktuell technische Agenten- und Executor-IDs sowie JSON-Zeitpläne und Parameter.
Die komfortable Auswahl bestätigter Agenten und Ausführungen, Kalenderanbindung,
produktiver Dispatch und Endabnahme bleiben offen.

Vertragstests und statischer Build wurden ausgeführt. Der geplante synthetische
Browser-Verhaltenstest wurde vor Ausführung durch die automatische
Freigabeprüfung mit „blocked by policy“ abgelehnt; keine Browserabnahme behauptet.
