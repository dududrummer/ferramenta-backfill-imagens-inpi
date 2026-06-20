#!/usr/bin/env bash
# Sobe N instâncias Tor com portas SOCKS/CONTROL pareadas.
# Uso: ./start-tor.sh "9050,9052,9054,9056" "9051,9053,9055,9057"
set -euo pipefail
SOCKS_PORTS="${1:-9050,9052,9054,9056}"
CONTROL_PORTS="${2:-9051,9053,9055,9057}"
IFS=',' read -ra S <<< "$SOCKS_PORTS"
IFS=',' read -ra C <<< "$CONTROL_PORTS"
DIR="$(cd "$(dirname "$0")" && pwd)"
# IMPORTANTE: o Tor exige permissão 700 no DataDirectory e RECUSA iniciar se a pasta
# for "too permissive". O /mnt/* (disco do Windows, no WSL) não suporta chmod, então
# os dados/logs ficam no FS nativo do Linux (~/.neopi-tor por padrão; sobrescreva com TOR_DATA_DIR).
BASE="${TOR_DATA_DIR:-$HOME/.neopi-tor}"
mkdir -p "$BASE"; chmod 700 "$BASE"
for i in "${!S[@]}"; do
  socks="${S[$i]}"; control="${C[$i]}"
  data="$BASE/tor$socks"
  mkdir -p "$data"; chmod 700 "$data"
  conf="$BASE/torrc-$socks"
  sed -e "s|__SOCKS__|$socks|" -e "s|__CONTROL__|$control|" -e "s|__DATA__|$data|" \
    "$DIR/torrc.template" > "$conf"
  echo "Subindo Tor SOCKS=$socks CONTROL=$control"
  tor -f "$conf" > "$BASE/tor$socks.log" 2>&1 &
done
echo "Aguardando bootstrap (10s)..."; sleep 10
echo "Instâncias Tor em execução. Logs em $BASE/*.log"
