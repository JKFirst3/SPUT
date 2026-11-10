# Sicherheit

Bitte melde Schwachstellen privat über [GitHub Security Advisories](https://github.com/JKFirst3/SPUT/security/advisories/new). Beschreibe die SPUT- und Node.js-Version, die betroffene Funktion, die möglichen Auswirkungen und die Schritte zum Nachstellen. Verwende synthetische Daten und halte Zugangsdaten, Teilnehmerdaten und vollständige Studien aus dem Bericht heraus. Für normale Fehler eignet sich ein öffentliches Issue mit synthetischen Beispielen.

Sicherheitskorrekturen gehen in den aktuellen Entwicklungsstand auf `main`. Beim Einsatz verwende den aktuellen Stand von `main` beziehungsweise einen neueren veröffentlichten Release.

SPUT ist eine lokale Einzelplatzanwendung. Der Server bindet an `127.0.0.1` und hat keine Benutzeranmeldung. Betreibe ihn im eigenen Benutzerkonto. Verzichte auf Portfreigaben, Tunnel und Reverse Proxies. Andere Prozesse auf demselben Rechner können auf die lokale API zugreifen. Importiere nur XLSX-Dateien aus vertrauenswürdigen Quellen.
