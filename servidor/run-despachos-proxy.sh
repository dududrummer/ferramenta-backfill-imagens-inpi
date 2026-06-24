#!/usr/bin/env bash
# Re-raspagem de DESPACHOS via PROXY (ex.: DataImpulse) numa máquina dedicada — SEM Tor.
# N processos Node paralelos (parsing cheerio usa os núcleos) sobre sub-faixas; todos passam pelo
# gateway de proxy com sticky sessions. Credenciais ficam no .env (NÃO commitado). Rode em screen.
#
#   cp .env.proxy.example .env   # e preencha PROXY_* / SSH_* / CH_DATABASE
#   screen -S desp
#   bash servidor/run-despachos-proxy.sh
set -euo pipefail

NUM_PROC="${NUM_PROC:-8}"            # processos (use ~nº de núcleos físicos)
CONC_POR_PROC="${CONC_POR_PROC:-60}"  # concorrência por processo
POOL_POR_PROC="${POOL_POR_PROC:-100}" # nº de sticky sessions (IPs distintos) por processo
MIN="${MIN:-4145}"
MAX="${MAX:-7000000}"

DIR="$(cd "$(dirname "$0")/.." && pwd)"; cd "$DIR"
npm install --silent

[ -f .env ] || { echo "ERRO: crie o .env (cp .env.proxy.example .env e preencha)."; exit 1; }
grep -q '^BACKEND=proxy' .env || echo "AVISO: .env não tem BACKEND=proxy — vai cair no Tor!"

SPAN=$(( (MAX - MIN + 1) / NUM_PROC ))
mkdir -p logs catalogos
echo "PROXY | $NUM_PROC processos × conc $CONC_POR_PROC × pool $POOL_POR_PROC | faixa $MIN-$MAX"
for ((i=0; i<NUM_PROC; i++)); do
  A=$(( MIN + i*SPAN ))
  if (( i == NUM_PROC-1 )); then B=$MAX; else B=$(( MIN + (i+1)*SPAN - 1 )); fi
  echo "  proc $i → faixa $A-$B"
  CONCURRENCY="$CONC_POR_PROC" PROXY_POOL_SIZE="$POOL_POR_PROC" CATALOG_PATH="catalogos/desp_$i.sqlite" \
    node src/cli.js run-despachos --range "$A-$B" > "logs/desp_$i.log" 2>&1 &
done
echo "Acompanhe:  tail -f logs/desp_*.log"
wait
echo "TODOS OS PROCESSOS TERMINARAM. Merge no droplet:  node worker/scripts/rerasp-merge.js"
