#!/bin/zsh

PORT="4173"

echo "SPUT wird beendet ..."

PIDS=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN)

if [[ -z "$PIDS" ]]; then
  echo "Es läuft aktuell kein SPUT-Server auf Port $PORT."
  osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
  exit 0
fi

for PID in ${(f)PIDS}; do
  COMMAND=$(ps -p "$PID" -o command=)
  if [[ "$COMMAND" == *"server/index.js"* ]] || [[ "$COMMAND" == *"node"* ]]; then
    echo "Beende SPUT-Prozess $PID ..."
    kill "$PID"
  else
    echo "Port $PORT wird von einem anderen Prozess verwendet:"
    echo "$COMMAND"
    echo "Dieser Prozess wurde nicht beendet."
  fi
done

sleep 1

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "SPUT konnte nicht vollständig beendet werden."
else
  echo "SPUT wurde beendet."
  osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
  exit 0
fi

read -k 1 "?Drücke eine Taste zum Schließen ..."
