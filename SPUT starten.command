#!/bin/zsh

SCRIPT_PATH="${0:A}"
PROJECT_DIR="${SCRIPT_PATH:h}"
PORT="4173"

cd "$PROJECT_DIR" || {
  echo "SPUT-Ordner wurde nicht gefunden: $PROJECT_DIR"
  read -k 1 "?Drücke eine Taste zum Schließen ..."
  exit 1
}

echo "SPUT wird gestartet ..."
echo "Projektordner: $PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm wurde nicht gefunden. Bitte Node.js installieren."
  read -k 1 "?Drücke eine Taste zum Schließen ..."
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "SPUT läuft bereits auf http://localhost:$PORT"
  open "http://localhost:$PORT"
  osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
  exit 0
fi

echo "Server wird im Hintergrund gestartet ..."
nohup npm start > "$PROJECT_DIR/.sput.log" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null

for _ in {1..30}; do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "SPUT läuft auf http://localhost:$PORT"
    open "http://localhost:$PORT"
    osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
    exit 0
  fi
  sleep 0.2
done

echo "SPUT konnte nicht gestartet werden. Details stehen in .sput.log."
read -k 1 "?Drücke eine Taste zum Schließen ..."
