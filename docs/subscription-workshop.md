# Externe Agenten in der Werkstatt

Die gemeinsame Agenten-Werkstatt unter `/agenten/blueprints` enthält den Bereich **Externe Agenten**. Der direkte Link lautet `/agenten/blueprints?tab=subscriptions`. Auch bei einem fehlgeschlagenen Bibliotheksabruf bleibt dieser Bereich erreichbar; seine Quellenprüfung meldet den eigenen Verfügbarkeitsstand.

Der Composer verwendet weiterhin den vorhandenen Blueprint-Katalog, die aktuelle Skill-Bibliothek und den bestehenden Vorschauadapter. Es entsteht keine zweite Konfigurationsbibliothek. Blueprint-Revisionen, Skill-Quellen, Vorschauvalidierung und das ausdrückliche Kopieren mit markierbarem Text als Fallback werden unverändert vom bisherigen Client geprüft.

Der alte Pfad `/agenten/subscription-agents` führt zur Werkstatt. Ohne JavaScript bleibt dort ein sichtbarer Link. Er enthält keinen zweiten Composer und keinen eigenen Navigationseintrag.

Zielclient und Arbeitskontext sind manuelle Prompt-Metadaten. Die Vorschau meldet keine bestätigte CLI-, Login-, Transport- oder Laufzeitfähigkeit. Kopieren startet keinen Agenten und übernimmt keine Aufgabe. Die Integration fügt keine Anmeldung oder Statusmeldung hinzu.

## Quellenstand und Abnahme

Die Änderung basiert auf Shared-GUI-Commit `1d6c0f985834f10ae9e5e051205a33b83efaaa54`. Dieser Stand ist als v0.2.28 veröffentlicht und liegt auf dem noch offenen Release-Branch aus PR77. Die Änderung wird darauf aufgebaut; sie ersetzt die neuere Oberfläche nicht durch den älteren Hauptbranch. Daraus folgt keine Aussage über die tatsächlich installierte Konsumentenversion. Vor einer Aktivierung sind die jeweilige BACH-/Ocean-Einbindung und Geräteabnahme separat zu bestätigen.

Der historische PR39-Composer und seine Quellenbelege bleiben erhalten. Diese Änderung liefert gemeinsame Oberfläche und Quellnachweise. Authentifizierte Adapter, Governance-, Boot-, Browser-/Geräte- und Laufzeitabnahme sind separat offen.
