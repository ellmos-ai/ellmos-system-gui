# GUI 0.2.8 – Domänen anpinnen
Task #1932 verbindet den gespeicherten Pinstand mit dem gemeinsamen Domänenmenü.

- Kopfmenü und Karten verwenden denselben bestätigten Backendstand.
- Anpinnen und Entfernen senden den ausdrücklich gewünschten Zustand plus aktuelle Version.
- Ein Versionskonflikt oder unbestätigtes ACK führt zum erneuten Lesen; keine automatische Überschreibung.
- Domänen ohne angebundene Fachseite öffnen ihre Katalogkarte. Stub-Fachlinks bleiben deaktiviert.
- Nicht mehr im Katalog vorhandene Pins bleiben sichtbar und können ausdrücklich entfernt werden.
- Ein fehlender oder unlesbarer Pinadapter deaktiviert das Speichern und meldet den unbekannten Stand.
- Ocean benötigt den dokumentierten Adaptervertrag bach.domain-pins.v1 oder einen exakt entsprechenden gemeinsamen Adapter. Das Frontend speichert keine eigene Pinliste.
- Zusätzliche private Pinmetadaten werden vom BACH-Speicher bewahrt.

Unabhängiger Review, Release und produktive Abnahme sind beim Anlegen dieser Notiz noch offen.
