#!/usr/bin/env bash
# Sobe a re-raspagem de despachos por TOR gerenciada pelo PM2 (auto-restart, sobrevive a desconexão,
# retoma pelo catálogo). Sobe o pool de Tor e dá pm2 start no ecosystem.
# Pré: node>=18, tor, pm2 (npm i -g pm2), chave SSH no droplet, e o .env (cp .env.tor.example .env).
#   bash servidor/pm2-up.sh
set -euo pipefail

NUM_PROC="${NUM_PROC:-8}"
PORTAS_POR_PROC="${PORTAS_POR_PROC:-3}"
CONC_POR_PROC="${CONC_POR_PROC:-50}"
MIN="${MIN:-4145}"
MAX="${MAX:-7000000}"

DIR="$(cd "$(dirname "$0")/.." && pwd)"; cd "$DIR"
[ -f .env ] || { echo "ERRO: crie o .env (cp .env.tor.example .env e ajuste SSH/CH)."; exit 1; }
npm install --silent

TOTAL=$(( NUM_PROC * PORTAS_POR_PROC ))
SOCKS=$(seq -s, 9050 2 $(( 9050 + (TOTAL-1)*2 )))
CONTROL=$(seq -s, 9051 2 $(( 9051 + (TOTAL-1)*2 )))
echo "Subindo $TOTAL instâncias Tor..."
bash tor/start-tor.sh "$SOCKS" "$CONTROL"

mkdir -p logs catalogos
echo "pm2 start: $NUM_PROC processos × conc $CONC_POR_PROC | faixa $MIN-$MAX"
NUM_PROC="$NUM_PROC" PORTAS_POR_PROC="$PORTAS_POR_PROC" CONC_POR_PROC="$CONC_POR_PROC" MIN="$MIN" MAX="$MAX" \
  pm2 start ecosystem.config.js --update-env
pm2 save
echo
echo "OK. Comandos:"
echo "  pm2 ls                 # status dos 8 processos"
echo "  pm2 logs               # logs ao vivo (todos)"
echo "  pm2 logs desp-0        # log de um"
echo "  pm2 stop all / pm2 delete all   # parar/remover"
echo "Quando todos ficarem 'stopped' (exit 0 = faixa concluída), faça o merge no droplet:"
echo "  node worker/scripts/rerasp-merge.js"
