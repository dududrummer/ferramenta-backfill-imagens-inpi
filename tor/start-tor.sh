#!/usr/bin/env bash
# Sobe N instâncias Tor com portas SOCKS/CONTROL pareadas.
# Uso: ./start-tor.sh "9050,9052,9054,9056" "9051,9053,9055,9057"
set -euo pipefail
SOCKS_PORTS="${1:-9050,9052,9054,9056}"
CONTROL_PORTS="${2:-9051,9053,9055,9057}"
IFS=',' read -ra S <<< "$SOCKS_PORTS"
IFS=',' read -ra C <<< "$CONTROL_PORTS"
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/data"
for i in "${!S[@]}"; do
  socks="${S[$i]}"; control="${C[$i]}"
  data="$DIR/data/tor$socks"
  mkdir -p "$data"; chmod 700 "$data"
  conf="$DIR/data/torrc-$socks"
  sed -e "s|__SOCKS__|$socks|" -e "s|__CONTROL__|$control|" -e "s|__DATA__|$data|" \
    "$DIR/torrc.template" > "$conf"
  echo "Subindo Tor SOCKS=$socks CONTROL=$control"
  tor -f "$conf" > "$DIR/data/tor$socks.log" 2>&1 &
done
echo "Aguardando bootstrap (10s)..."; sleep 10
echo "Instâncias Tor em execução. Logs em $DIR/data/*.log"
