#!/usr/bin/env bash
# Turbo no Colab em UM comando: setup (idempotente) + chave SSH + teste + execução da faixa.
#
# Numa célula do Colab (chave no seu Drive — recomendado, retoma sem duplicar):
#   RANGE="2500000-2520000"; KEY="/content/drive/MyDrive/id_rsa"
#   from google.colab import drive; drive.mount('/content/drive')
#   import os; os.environ.update(RANGE=RANGE, KEYSRC=KEY)
#   !curl -fsSL https://raw.githubusercontent.com/dududrummer/ferramenta-backfill-imagens-inpi/master/turbo/colab_run.sh | bash
#
# OU sem Drive, colando a chave (catálogo local; rotacione a chave depois):
#   import os; os.environ['RANGE']='2500000-2520000'
#   os.environ['TURBO_KEY']='''-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'''
#   !curl -fsSL .../turbo/colab_run.sh | bash
#
# Variáveis: RANGE (obrig.), KEYSRC (caminho da chave) ou TURBO_KEY (conteúdo),
#            PORTS (def 2), CPP (circuitos/porta, def 20).
set -e
: "${RANGE:?defina RANGE=INICIO-FIM (ex.: 2500000-2520000)}"
REPO=https://github.com/dududrummer/ferramenta-backfill-imagens-inpi.git

if [ ! -d /content/bf ]; then
  echo "[setup] Tor + Node 18 + deps + repo (~1-2 min)..."
  apt-get -qq update; apt-get -qq install -y tor >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash - >/dev/null 2>&1
  apt-get -qq install -y nodejs >/dev/null
  pip -q install requests PySocks
  git clone -q "$REPO" /content/bf
  (cd /content/bf && npm install --silent)
fi
cd /content/bf

mkdir -p /root/.ssh
printf 'Host 68.183.113.157\n  StrictHostKeyChecking no\n  UserKnownHostsFile=/dev/null\n' > /root/.ssh/config
chmod 600 /root/.ssh/config
printf 'MODO=remoto\nSSH_HOST=68.183.113.157\nSSH_USER=root\nSSH_KEY=/root/.ssh/turbo_key\nREMOTE_IMAGE_DIR=/data/bancoImagensINPI\nCH_DATABASE=neopi\n' > .env

# chave SSH: de KEYSRC (caminho, ex.: no Drive) ou de TURBO_KEY (conteúdo)
if [ -n "${KEYSRC:-}" ] && [ -f "${KEYSRC:-}" ]; then cp "$KEYSRC" /root/.ssh/turbo_key
elif [ -n "${TURBO_KEY:-}" ]; then printf '%s\n' "$TURBO_KEY" > /root/.ssh/turbo_key
fi
if [ ! -f /root/.ssh/turbo_key ]; then echo "ERRO: chave SSH ausente — defina KEYSRC (caminho) ou TURBO_KEY (conteúdo)."; exit 1; fi
chmod 600 /root/.ssh/turbo_key

echo -n "[ssh] SELECT 1 -> "
ssh -i /root/.ssh/turbo_key root@68.183.113.157 'clickhouse-client --query "SELECT 1"' \
  || { echo "FALHOU — a chave nao esta autorizada no droplet (~/.ssh/authorized_keys)."; exit 1; }

A="${RANGE%-*}"; B="${RANGE#*-}"
if [ -d /content/drive/MyDrive ]; then CATDIR=/content/drive/MyDrive/turbo_catalogos; else CATDIR=/content/bf/catalogos; fi
mkdir -p "$CATDIR"
echo "[run] faixa $RANGE | catalogo $CATDIR/turbo_${A}_${B}.sqlite"
exec python3 turbo/turbo.py --range "$RANGE" --ports "${PORTS:-2}" --circuits-per-port "${CPP:-20}" \
  --max-tentativas 5 --catalog "$CATDIR/turbo_${A}_${B}.sqlite"
