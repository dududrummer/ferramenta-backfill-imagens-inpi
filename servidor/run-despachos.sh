#!/usr/bin/env bash
# Re-raspagem de DESPACHOS numa MÁQUINA DEDICADA (não-Colab): lança N processos Node em paralelo
# (1 por núcleo — o parsing cheerio é CPU-bound) sobre sub-faixas de n_url, compartilhando um pool
# de Tor. Cada processo grava nas tabelas de staging *_rerasp do droplet via clickhouse-client/SSH.
# Retomável (catálogo por processo). Rode dentro de screen/tmux.
#
# Pré-requisitos no servidor: node>=20, tor, git, e chave SSH que acessa o droplet.
# Uso:
#   git clone https://github.com/dududrummer/ferramenta-backfill-imagens-inpi.git bf && cd bf
#   screen -S desp
#   SSH_HOST=68.183.113.157 SSH_KEY=/root/.ssh/id_rsa bash servidor/run-despachos.sh
set -euo pipefail

# ===== CONFIG (via env, com defaults sensatos) =====
SSH_HOST="${SSH_HOST:-68.183.113.157}"
SSH_USER="${SSH_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
CH_DATABASE="${CH_DATABASE:-neopi}"
NUM_PROC="${NUM_PROC:-8}"               # processos Node paralelos (use ~nº de núcleos físicos)
PORTAS_POR_PROC="${PORTAS_POR_PROC:-3}" # instâncias Tor por processo (total = NUM_PROC*este)
CONC_POR_PROC="${CONC_POR_PROC:-50}"    # concorrência por processo; total ≈ ótimo do INPI (~400)
MIN="${MIN:-4145}"
MAX="${MAX:-7000000}"
# ===================================================

DIR="$(cd "$(dirname "$0")/.." && pwd)"   # raiz do repo
cd "$DIR"
npm install --silent

TOTAL=$(( NUM_PROC * PORTAS_POR_PROC ))
SOCKS=$(seq -s, 9050 2 $(( 9050 + (TOTAL-1)*2 )))
CONTROL=$(seq -s, 9051 2 $(( 9051 + (TOTAL-1)*2 )))
echo "Subindo $TOTAL instâncias Tor..."
bash tor/start-tor.sh "$SOCKS" "$CONTROL"

# .env comum (config exige SSH_*/REMOTE_IMAGE_DIR no modo remoto). O que varia por processo
# (portas Tor, catálogo, concorrência) é passado por env e tem precedência sobre o .env.
cat > .env <<ENV
MODO=remoto
SSH_HOST=$SSH_HOST
SSH_USER=$SSH_USER
SSH_KEY=$SSH_KEY
REMOTE_IMAGE_DIR=/data/bancoImagensINPI
CH_DATABASE=$CH_DATABASE
TOR_HOST=127.0.0.1
RATE_PER_CIRCUIT=1000
MAX_REQ_POR_CIRCUITO=100000
RSYNC_BATCH=500
ENV

IFS=',' read -ra S <<< "$SOCKS"
IFS=',' read -ra C <<< "$CONTROL"
SPAN=$(( (MAX - MIN + 1) / NUM_PROC ))
mkdir -p logs catalogos
echo "Lançando $NUM_PROC processos | conc/proc $CONC_POR_PROC (total $(( NUM_PROC*CONC_POR_PROC ))) | faixa $MIN-$MAX"

for ((i=0; i<NUM_PROC; i++)); do
  A=$(( MIN + i*SPAN ))
  if (( i == NUM_PROC-1 )); then B=$MAX; else B=$(( MIN + (i+1)*SPAN - 1 )); fi
  st=$(( i*PORTAS_POR_PROC )); ps=""; pc=""
  for ((j=0; j<PORTAS_POR_PROC; j++)); do ps+="${S[$((st+j))]},"; pc+="${C[$((st+j))]},"; done
  ps=${ps%,}; pc=${pc%,}
  echo "  proc $i → faixa $A-$B | Tor $ps"
  TOR_SOCKS_PORTS="$ps" TOR_CONTROL_PORTS="$pc" CONCURRENCY="$CONC_POR_PROC" \
  CATALOG_PATH="catalogos/desp_$i.sqlite" \
    node src/cli.js run-despachos --range "$A-$B" > "logs/desp_$i.log" 2>&1 &
done
echo "Acompanhe:  tail -f logs/desp_*.log"
wait
echo "TODOS OS PROCESSOS TERMINARAM. Faça o merge no droplet:  node worker/scripts/rerasp-merge.js"
