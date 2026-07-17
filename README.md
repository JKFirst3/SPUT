# SPUT

**Statistical Package for User Testing** ist ein lokales Analysewerkzeug für UserTesting-Exporte.

## Start

Am einfachsten auf dem Mac:

1. Node.js installieren, falls es noch nicht vorhanden ist.
2. `SPUT starten.command` per Rechtsklick > Öffnen starten.
3. Wenn der Browser nicht automatisch aufgeht: [http://localhost:4173](http://localhost:4173) öffnen.
4. Zum Beenden `SPUT beenden.command` starten.

Unter Windows:

1. Node.js installieren, falls es noch nicht vorhanden ist.
2. `SPUT starten.bat` doppelklicken.
3. Zum Beenden `SPUT beenden.bat` doppelklicken.

Die Startdateien verwenden automatisch den Ordner, in dem sie liegen. Der SPUT-Ordner kann deshalb auf einen anderen Rechner kopiert oder verschoben werden, ohne Pfade in den Dateien anzupassen.

Manuell im Terminal:

```bash
npm install
npm start
```

Danach läuft SPUT unter [http://localhost:4173](http://localhost:4173).

## Aktueller Funktionsumfang

- Import von UserTesting-Umfrageexporten im XLSX-Format
- automatische Erkennung des dreizeiligen Exportschemas
- Rekonstruktion von Fragen mit mehreren Antwortspalten
- Erkennung von Einfach-/Mehrfachauswahl, offenen Antworten, Skalen, Matrix und Ranking
- verbindlicher Import-Prüfschritt für Studienname, Fragetext, Antwortoptionen und Fragetyp
- technische Exportspalten wie „Antwort“ und „Andere“ werden nicht als Optionen behandelt
- „Andere“ wird als separater Freitextkanal erkannt; die tatsächlich gewählten Antworten bilden die Optionsliste
- Anweisungen und Hinweise werden als eigener, nicht analysierbarer Inhaltstyp erkannt
- Fragen erscheinen im normalen Datenpool immer genau einmal als vollständige Frage
- einzelne Matrix-/Ranking-Items werden nur im Expertenmodus als Untervariablen angeboten
- automatisch generiertes Dashboard
- vollständiger KI-Export als JSON inklusive Datenwörterbuch, Rohdaten, Zusammenfassungen und editierbarem Prompt
- kompakter Prompt-Export als Markdown
- interaktives Filter-Dashboard mit klickbaren Diagrammen für Demografie, Fragen, Skalen und Freitext-Themen
- speicherbare gefilterte Segmentansichten inklusive aktiver Filter und ausgeblendeter Kacheln
- interner Ansichtsspeicher im Projektordner `.saved-views` oder externer Speicher per Finder-Dateidialog
- anklickbare Dashboard-Kacheln mit direktem Wechsel in Daten oder Analyse
- Zielgruppen-Explorer für demografische, regionale und technische Segmente
- lokale Regionskarte mit Teilnehmerverteilung, sofern Länder- und Regionsdaten vorhanden sind
- Themencluster für offene Antworten
- Datenexplorer mit frei wählbaren Spalten, Bereichsfilter und Fallsuche
- deskriptive Statistik, Kreuztabellen, Pearson- und Spearman-Korrelation
- Chi-Quadrat-Unabhängigkeitstest mit Cramérs V
- Welch-t-Test für zwei Gruppen und einfaktorielle ANOVA für mehr als zwei Gruppen
- segmentierte Wort- und Themenanalyse für Freitext × Kategorie/Zahlenwert
- methodenabhängige Anzeige statistisch kompatibler Variablen
- geführter Analyse-Assistent mit verständlicher Kernaussage für Nutzer ohne Statistikkenntnisse
- separater Expertenmodus mit direkter Auswahl der statistischen Methode
- kategorisierter Datenpool für Durchführung, Zielgruppe, Auswahlfragen, Skalen und Freitext
- Studienbibliothek zum Laden und Kombinieren mehrerer Länder-/Sprachvarianten desselben Tests
- Herkunftsvariable pro Fall bei kombinierten Datensätzen
- verständliche Interpretationshinweise zu Tests, p-Werten und Effektstärken
- PNG-Export erzeugter Diagramme und CSV-Export tabellarischer Testergebnisse
- rein lokale Verarbeitung

Andere UserTesting-Testarten sind im Datenmodell vorgesehen, werden in dieser Version aber noch nicht ausgewertet.
