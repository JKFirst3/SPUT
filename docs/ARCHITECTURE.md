# SPUT-Architektur

## Ziel

SPUT verarbeitet UserTesting-XLSX-Exporte lokal. Die Architektur trennt Datenimport, Fachlogik, Speicherung, Export und Darstellung. Dadurch kann eine Funktion getestet und geändert werden, ohne unbeabsichtigt eine andere zu ersetzen.

## Schichten

1. **Browseroberfläche (`public/`)**: Seiten, Diagramme, Dialoge und Interaktionen. `ApiClient` kapselt HTTP-Zugriffe. `ProjectManager` bildet den Projektablauf ab.
2. **HTTP-Schicht (`server/index.js`)**: validiert Anfragen, ordnet Statuscodes zu und delegiert an Dienste.
3. **Fachdienste (`server/*-service.js`)**: Vergleich, Export, Update-Prüfung und Freitextanalyse.
4. **Datenzugriff (`DatasetStore`, `ProjectRepository`)**: laufende Datensätze im Speicher; vollständige Projekte als versionierte JSON-Dateien unter `.projects`.
5. **Parser und Statistik (`parser.js`, `analysis.js`, `combine.js`, `geography.js`)**: UserTesting-Schema, statistische Verfahren, Datensatzkombination und Geografie.

## Zentrale Klassen

- `DatasetStore`: einzige Zuständigkeit für Datensätze der aktuellen Sitzung.
- `ProjectRepository`: atomare fachliche Grenze für das persistente Projektformat.
- `ComparisonService`: unverändernder Direktvergleich gemeinsamer Fragen.
- `ExportService`: Excel-Arbeitsmappe und druckbarer HTML-Ergebnisbericht.
- `TextAnalysisService`: Begriffe, Abdeckung und Themen aus einem prüfbaren Kookkurrenzgraphen.
- `TermGraph`: Adjazenzstruktur und Tiefensuche für verbundene Begriffskomponenten.
- `UpdateService`: passive, vom Nutzer ausgelöste Prüfung veröffentlichter GitHub-Releases.
- `ApiClient` und `ProjectManager`: Browserzugriff und Projektablauf ohne verteilte Fetch-Details.
- `design-themes.js`: zentrale, getestete Diagrammpaletten und Normalisierung für die klassische und die Miele-GUI; CSS-Design-Tokens übernehmen die vollständige Oberflächengestaltung.

## Oberflächendesigns

`data-gui="classic|miele"` am Wurzelelement wählt das Designsystem, `data-theme="light|dark"` bleibt davon unabhängig. Dadurch stehen klassisches und Miele-Design jeweils in heller und dunkler Darstellung zur Verfügung. Die Auswahl wird ausschließlich lokal unter `sput.guiDesign` gespeichert. Das Miele-Logo liegt als lokales PNG unter `public/assets`; es wird nur im Miele-Modus eingeblendet und verursacht keine externe Anfrage.

## Projekt und Ansicht

Ein **Projekt** enthält vollständige Studien, Datensätze und die aktive Studie. Es bleibt nach einem Neustart erhalten. Eine **Ansicht** enthält ausschließlich interaktive Filter und ausgeblendete Kacheln. Beide Formate sind absichtlich getrennt.

## Freitext-Garantien

- Originalantworten bleiben vollständig und in Importreihenfolge verfügbar.
- Automatische Themen verweisen auf Originalbelege und weisen ihre Abdeckung aus.
- Es werden keine unbelegten Sentiments oder Bedeutungen erfunden.
- Themen sind eine Such- und Strukturierungshilfe, keine fehlerfreie Inhaltscodierung.

## Erweiterungsregel

Neue Features erhalten Fachlogik in einem passenden Dienst, Tests für die Kernregeln, einen Eintrag in README/Anleitung und – falls das Datenformat betroffen ist – eine Versionsnummer. Abhängigkeiten zwischen Diensten sollen über kleine Datenobjekte laufen, nicht über globale Zustände.
