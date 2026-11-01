# GUI-Agenten: Living & Running und Bibliothek

Diese Dokumentation beschreibt den gemeinsamen GUI-Vertrag für BACH und Ocean. Sie belegt keinen laufenden Backend- oder Consumer-Zustand.

## Hauptpunkt

`/agenten/running` ist der zentrale Einstieg für Agenten-Zustände:

- `Running` bedeutet einen aktuellen, bestätigten Lauf.
- `Living` beziehungsweise `Ready` bedeutet ein konfiguriertes, einsatzbereites Profil ohne bestätigten Lauf.
- Ein gespeichertes Profil, eine Vorlage oder ein Prompt darf keinen Laufstatus vortäuschen.
- Start- und Änderungsaktionen bleiben ausdrücklich; das Öffnen einer Vorlage startet nichts.

Die Seite trennt aktive Läufe, einsatzbereite Profile, Verlauf und Ressourcenmessung. Ohne aktuelle Adapterantwort bleiben Laufzeit- und Modellangaben als nicht bestätigt beziehungsweise nicht verfügbar sichtbar.

## Agenten-Bibliothek

`/agenten/fabrika` bündelt die drei Auswahl- und Bearbeitungsbereiche:

1. **Vorlagen** (`/agenten/blueprints`) für versionierte Rollen-, Skill- und Agentenprofile.
2. **Prompt-Agenten** (`/agenten/subscription-agents`) für quellengebundene Prompts. Sie werden extern zugeschaltet und von dieser GUI nicht gesteuert.
3. **Ketten** (`/agenten/marblerun`) für Ablaufentwürfe aus Agenten oder Skills.

Die Bibliothek ist keine Laufzeitübersicht. Nach der Auswahl führt der Weg für bestätigte Zustände zurück zu Living & Running.

## Modellquellen

Die Oberfläche enthält keine feste Modellliste und keinen erfundenen Fallback. Modelle werden aus dem jeweiligen Adapterkatalog oder aus einer bereits gespeicherten, vom Adapter gelieferten Bindung angezeigt. Ist der Katalog nicht verfügbar, bleibt die Auswahl gesperrt oder als nicht verfügbar gekennzeichnet.

## Nicht enthalten

Diese GUI-Quelle liefert keine BACH-/Ocean-Datenbank, keine Zugangsdaten und keinen Beleg für einen gestarteten Worker, einen verbundenen Consumer oder eine erfolgreiche native Ausführung.
