# SPUT

SPUT steht für **Statistical Package for User Testing**. Die App analysiert XLSX-Umfrageexporte von UserTesting lokal im Browser. Sie unterstützt aktuelle Exporte mit einem Datenblatt und ältere Exporte mit mehreren Länderblättern.

## Installation und Start

Du brauchst [Node.js 22 oder 24](https://nodejs.org/en/download) und einen aktuellen Browser. Lade den [Quellcode als ZIP](https://github.com/JKFirst3/SPUT/archive/refs/heads/main.zip) herunter und entpacke ihn. Alternativ kannst du das Repository klonen.

```sh
git clone https://github.com/JKFirst3/SPUT.git
cd SPUT
```

Öffne im entpackten oder geklonten Ordner ein Terminal und führe aus:

```sh
npm ci
npm start
```

Öffne [http://localhost:4173](http://localhost:4173). Beende den Server im Terminal mit **Strg+C**. Falls der Port belegt ist, kannst du die Umgebungsvariable `PORT` setzen und die entsprechende Adresse öffnen. Falls dein Browser `localhost` nicht erreicht, verwende [http://127.0.0.1:4173](http://127.0.0.1:4173).

Nach `npm ci` kannst du auf macOS auch `SPUT starten.command` und auf Windows `SPUT starten.bat` verwenden. Zum Beenden dienen die jeweiligen Dateien mit `SPUT beenden` im Namen.

## Erste Analyse

1. Erzeuge im Projektordner mit `npm run demo` eine Datei namens `SPUT-Beispiel.xlsx`. Sie enthält vier erfundene Fälle, eine Auswahlfrage, Freitext, eine Matrix und eine Rankingfrage.
2. Importiere die Datei über die App. Prüfe den Studiennamen, die erkannten Fragen und ihre Typen. Bestätige den Import.
3. Öffne das Dashboard und probiere die Filter aus. Unter **Analyse** kannst du Variablen vergleichen und die passende Auswertung auswählen.
4. Speichere die Studie als Projekt, wenn du sie nach einem Neustart weiterbearbeiten willst.

Für eigene Studien benötigst du den originalen XLSX-Umfrageexport mit seinen drei Kopfzeilen. Die Uploadgrenze beträgt 30 MiB pro Datei. Die App erkennt unter anderem Einfach- und Mehrfachauswahl, Skalen, Freitext, Matrix und Ranking.

## Funktionen

- Dashboard mit klickbaren Filtern, Zielgruppen-Explorer und Regionskarte, wenn geografische Angaben vorliegen.
- Datenexplorer mit Fallsuche, auswählbaren Spalten und Bereichsfiltern.
- Geführte Analyse und Expertenmodus für deskriptive Statistik, Kreuztabellen, Korrelationen, Gruppenvergleiche und Freitext-Themen.
- Projektbibliothek zum Speichern, Kombinieren und Vergleichen von Studien. Kombinierte Daten behalten die Herkunft pro Fall.
- Exporte als Excel, CSV, PNG und druckbarer HTML-Bericht sowie JSON- und Markdown-Exporte für die weitere Analyse.

## Lokale Daten und Sicherheit

SPUT ist für eine Person am eigenen Rechner gedacht. Verwende die lokale Adresse und importiere Dateien aus vertrauenswürdigen Quellen. Die [Sicherheitsrichtlinie](SECURITY.md) beschreibt die Grenzen des lokalen Betriebs und den privaten Meldeweg.

- Geladene Studien liegen bis zum Beenden im Arbeitsspeicher. Der Import legt während der Verarbeitung eine temporäre Kopie unter `.uploads` ab.
- Gespeicherte Projekte unter `.projects` enthalten vollständige Studien einschließlich Rohdaten. Gespeicherte Ansichten unter `.saved-views` enthalten Filter und ausgeblendete Kacheln. Filterwerte können sensible Angaben enthalten.
- Prüfe Exporte vor dem Teilen. Insbesondere Excel- und KI-JSON-Exporte können Rohdaten enthalten. Ein Upload eines Exports zu einem KI-Dienst gibt die enthaltenen Daten an den jeweiligen Anbieter weiter.
- Die Analyse läuft lokal. Die manuelle Update-Prüfung fragt nur die Release-Informationen auf GitHub ab. Die Installation von Abhängigkeiten über npm erfordert Internetzugang.

## Entwicklung und Lizenz

Mit `npm test` laufen die öffentlichen Tests mit synthetischen Daten. Optionale Kompatibilitätstests verwenden lokal bereitgestellte XLSX-Dateien und werden ohne die passenden Umgebungsvariablen übersprungen. Die Dateipfade werden über `SPUT_FIXTURE`, `SPUT_RANKING_FIXTURE` oder das Paar `SPUT_LEGACY_FIXTURE` und `SPUT_CURRENT_FIXTURE` gesetzt. Diese Tests erwarten die jeweils in den Assertions beschriebenen Exportprofile.

Siehe [Mitwirken](CONTRIBUTING.md), [Architektur](docs/ARCHITECTURE.md) und [Versionierung](docs/VERSIONING.md). Der SPUT-Code steht unter der [MIT-Lizenz](LICENSE). Abhängigkeiten haben eigene Lizenzen. SPUT ist ein unabhängiges Projekt.
