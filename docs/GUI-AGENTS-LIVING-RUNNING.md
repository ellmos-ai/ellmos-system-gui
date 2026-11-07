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

## Agentenkacheln

Jede Kachel auf `/agenten/running` entsteht in `src/lib/agent-tile.mjs` (PB-5b). Systemplätze, Systemprofile, Hintergrundworker (bereit und laufend), die Funkgerät-Karte und die optionalen Schnittstellen haben denselben Aufbau.

- **Slots in fester Reihenfolge:** `head` (Bild, Name, Art), `status` (Text plus Punkt, Ton über `data-tone`), `model`, `task`, `error`, `actions`. Der Fehlerslot ist leer und verborgen, bis es etwas zu sagen gibt. Bei Status Fehler ohne gemeldete Ursache steht dort, dass das Backend keine Ursache gemeldet hat.
- **Aktionen in fester Reihenfolge:** Start/Fortsetzen/Pausieren (bei Systemplätzen der Ein/Aus-Schalter), Bearbeiten, Chat, Zuweisen und das Menü Mehr (Pausieren, Stoppen, Kontext übergeben, Task zerlegen, Löschen). Eine nicht verfügbare Aktion bleibt sichtbar, ist mit `aria-disabled` gesperrt und nennt den Grund im Tooltip und für Screenreader.
- **Keine Emoji in der Kachel.** Die Evidenz aus PB-4 (Rückgabe-Schild, Klartext-Grund des letzten Providerlaufs, Wartezustand) steht im Fehlerslot.
- Die Evidenzliste (ID, Zugang, Startart, Werkzeug, Runde) liegt hinter dem Eintrag Details. Das Dashboard nutzt dieselbe Liste über `createAgentOverviewMeta`.

Steuerelemente, die bisher Emoji trugen, verwenden Symbolpaare aus `src/lib/ui-icons.mjs` (Linienform im Standard, Emoji nur im Symbolstil Emoji). Herkunft: von agy erzeugt, das gelaufene Modell ist nicht belegt; die Pfade folgen zum Teil Feather (MIT) und Lucide (ISC), teils mit identischer Geometrie. Die Quelle je Icon steht in `ICON_SOURCES`, die Lizenztexte in `THIRD_PARTY_LICENSES.md`.

## Modellquellen

Die Oberfläche enthält keine feste Modellliste und keinen erfundenen Fallback. Modelle werden aus dem jeweiligen Adapterkatalog oder aus einer bereits gespeicherten, vom Adapter gelieferten Bindung angezeigt. Ist der Katalog nicht verfügbar, bleibt die Auswahl gesperrt oder als nicht verfügbar gekennzeichnet.

## Nicht enthalten

Diese GUI-Quelle liefert keine BACH-/Ocean-Datenbank, keine Zugangsdaten und keinen Beleg für einen gestarteten Worker, einen verbundenen Consumer oder eine erfolgreiche native Ausführung.
