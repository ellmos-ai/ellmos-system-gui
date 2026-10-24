# Externe Agenten in der Werkstatt

Die gemeinsame Agenten-Werkstatt unter `/agenten/blueprints` enthält den Bereich **Externe Agenten**. Der direkte Link lautet `/agenten/blueprints?tab=subscriptions`. Auch bei einem fehlgeschlagenen Bibliotheksabruf bleibt dieser Bereich erreichbar; seine Quellenprüfung meldet den eigenen Verfügbarkeitsstand.

Der Composer verwendet weiterhin den vorhandenen Blueprint-Katalog, die aktuelle Skill-Bibliothek und den bestehenden Vorschauadapter. Es entsteht keine zweite Konfigurationsbibliothek. Blueprint-Revisionen, Skill-Quellen, Vorschauvalidierung und das ausdrückliche Kopieren mit markierbarem Text als Fallback werden weiterhin vom gemeinsamen Client geprüft.

Der alte Pfad `/agenten/subscription-agents` führt zur Werkstatt. Ohne JavaScript bleibt dort ein sichtbarer Link. Er enthält keinen zweiten Composer und keinen eigenen Navigationseintrag.

Zielclient und Arbeitskontext sind manuelle Prompt-Metadaten. Die Vorschau meldet keine bestätigte CLI-, Login-, Transport- oder Laufzeitfähigkeit. Kopieren startet keinen Agenten und übernimmt keine Aufgabe. Die Integration fügt keine Anmeldung oder Statusmeldung hinzu.

## Quellenstand und Abnahme

Die Änderung basiert auf Shared-GUI-Commit `1d6c0f985834f10ae9e5e051205a33b83efaaa54`. Dieser Stand ist als v0.2.28 veröffentlicht und liegt auf dem noch offenen Release-Branch aus PR77. Die Änderung wird darauf aufgebaut; sie ersetzt die neuere Oberfläche nicht durch den älteren Hauptbranch. Daraus folgt keine Aussage über die tatsächlich installierte Konsumentenversion. Vor einer Aktivierung sind die jeweilige BACH-/Ocean-Einbindung und Geräteabnahme separat zu bestätigen.

Der historische PR39-Composer und seine Quellenbelege bleiben erhalten. Diese Änderung liefert gemeinsame Oberfläche und Quellnachweise. Authentifizierte Adapter, Governance-, Boot-, Browser-/Geräte- und Laufzeitabnahme sind separat offen.

## Bootquellen im vollständigen Textmodus

Der Bereich **Externe Agenten** verlangt nun je eine ausdrücklich ausgewählte
Quelle für **Systemwissen** und **BACH-Anleitung**. Beide Auswahlfelder
verwenden dieselbe aktuelle Skillbibliothek wie die Zusatzskills. Die
fachliche Zuordnung erfolgt durch die Person, die den Prompt erstellt; ein
passender Dateiname allein bestätigt sie nicht.

Der Client übernimmt zu jeder Bootquelle deren aktuelle SHA-256-Quellenversion
und fordert den Vertrag `bach.subscription-agent-onboarding.request.v2` an.
Die Antwort muss `preview.v2`, dieselben Bootrollen und Pins sowie
`boot_delivery.mode=text` bestätigen. Zielzugriff und fachliche Eignung bleiben
ausdrücklich unbestätigt. Der Backendvertrag ist im BACH-Draft
[PR483](https://github.com/ellmos-ai/bach/pull/483) am Commit
`943fd7bb9e7695d60afed0f39659185ab07bd65c` beschrieben. Die Veröffentlichung
dieses Frontend-Quellstands installiert oder aktiviert diesen Backendstand
nicht.

Boot-, Blueprint- und Zusatzskills werden gemeinsam nach ID dedupliziert und
auf höchstens 30 verschiedene Quellen begrenzt. Die v2-Antwortprüfung
vergleicht auch die Rollen an jedem Skillbeleg; zusätzliche, vertauschte oder
widersprüchliche Angaben werden nicht übernommen. Die bekannten v1-Funktionen
bleiben für bestehende direkte Aufrufer separat erhalten. Die Werkstatt selbst
fällt bei einem v1-Backend nicht still auf eine Vorschau ohne Bootbindung zurück.

Bei Änderungen am Formular wird die bisherige Vorschau ungültig und die
Kopieraktion gesperrt. Nachträglich eintreffende Antworten für diese alte Auswahl
dürfen sie nicht wieder freischalten. **Quellen neu laden** setzt auch beide
Bootauswahlen zurück; ältere parallele Ladevorgänge werden verworfen.

Die vollständigen Texte kommen ausschließlich vom vorhandenen Composer.
Es entsteht kein zweiter Skill- oder Bootspeicher. Es werden weder lokale
Dateipfade aus dem Browser geöffnet noch Agenten gestartet oder Tasks übernommen.
Eine fehlende geeignete Quelle bleibt ein sichtbarer fehlender Quellenbeleg
beziehungsweise eine nicht erfüllbare Auswahl.

Diese Lieferung ergänzt GUI-Quellen und strenge Vertragsprüfung auf dem
Werkstattstand aus PR95. Browser-/Geräteverhalten und tatsächlich installierte
BACH-/Ocean-Adapter sind dadurch noch nicht abgenommen. Pfadmodus und Ocean-
Parität sowie fachlich geeignete Bootquellen bleiben erforderliche Folgeschritte.
