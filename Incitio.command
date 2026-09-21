#!/bin/zsh
# Dobbeltklik for at starte Incitio: API + studio i én proces-gruppe,
# browseren åbnes når studioet svarer, og begge lukkes ned igen når
# vinduet lukkes eller du trykker Ctrl-C.

set -u
cd "$(dirname "$0")"

API_PORT=${PORT:-8787}
UI_PORT=5173

port_busy() { lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if port_busy $UI_PORT && port_busy $API_PORT; then
  echo "Incitio kører allerede — åbner browseren."
  open "http://localhost:$UI_PORT"
  exit 0
fi

for port in $API_PORT $UI_PORT; do
  if port_busy $port; then
    echo "Port $port er optaget af en gammel proces — lukker den."
    lsof -ti tcp:$port -sTCP:LISTEN | xargs kill 2>/dev/null
  fi
done

if [ ! -d node_modules ]; then
  echo "Installerer afhængigheder (første gang)…"
  npm install || { echo "npm install fejlede."; read "?Tryk retur for at lukke."; exit 1; }
fi

pids=()
cleanup() {
  echo "\nLukker Incitio ned…"
  for pid in ${pids[@]}; do kill $pid 2>/dev/null; done
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM HUP

npm run dev:api & pids+=($!)
npm run dev:studio & pids+=($!)

echo "Starter Incitio…"
for _ in {1..60}; do
  curl -sf "http://localhost:$UI_PORT" >/dev/null && break
  sleep 0.5
done

if curl -sf "http://localhost:$UI_PORT" >/dev/null; then
  open "http://localhost:$UI_PORT"
  echo "Incitio kører på http://localhost:$UI_PORT — luk vinduet for at stoppe."
else
  echo "Studioet svarede ikke på port $UI_PORT. Se fejlen ovenfor."
fi

wait
