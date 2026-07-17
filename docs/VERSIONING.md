# Versionierung

SPUT verwendet Semantic Versioning `MAJOR.MINOR.PATCH`.

- `PATCH` (`1.0.1`): rückwärtskompatible Fehlerkorrektur.
- `MINOR` (`1.1.0`): neue rückwärtskompatible Funktion.
- `MAJOR` (`2.0.0`): inkompatible Änderung an Bedienung, API oder gespeicherten Formaten.

Die erste zusammenhängend veröffentlichbare Version nach dem Prototyp `0.1.0` ist `1.0.0`. Frühere, nicht als eigene Git-Commits vorhandene Arbeitsstände werden nicht nachträglich als vermeintliche Releases gezählt.

Die maßgebliche Versionsnummer steht in `package.json`. Oberfläche, Health-API, Update-Prüfung und Exporte lesen sie daraus oder zeigen denselben Build-Wert an. Veröffentlichte GitHub-Versionen werden als Releases mit Tag `v1.0.0`, `v1.1.0` usw. angelegt.
