#!/usr/bin/env bash
# Setup do turbo no Google Colab em UM comando. Numa célula do Colab:
#   !curl -fsSL https://raw.githubusercontent.com/dududrummer/ferramenta-backfill-imagens-inpi/master/turbo/colab_setup.sh | bash
# Instala Tor + Node 18 + libs Python, clona o repo, roda npm install e escreve o .env (MODO=remoto).
# Depois: suba a chave SSH em /root/.ssh/turbo_key e rode o turbo.
set -e

echo "[1/4] Tor + Node 18 + requests/PySocks..."
apt-get -qq update
apt-get -qq install -y tor >/dev/null
curl -fsSL https://deb.nodesource.com/setup_18.x | bash - >/dev/null 2>&1
apt-get -qq install -y nodejs >/dev/null
pip -q install requests PySocks

echo "[2/4] clonando o repo + node_modules..."
mkdir -p /content && cd /content
rm -rf bf
git clone -q https://github.com/dududrummer/ferramenta-backfill-imagens-inpi.git bf
cd /content/bf
npm install --silent

echo "[3/4] .env (MODO=remoto) + ssh config..."
mkdir -p /root/.ssh
printf 'Host 68.183.113.157\n  StrictHostKeyChecking no\n  UserKnownHostsFile=/dev/null\n' > /root/.ssh/config
chmod 600 /root/.ssh/config
printf 'MODO=remoto\nSSH_HOST=68.183.113.157\nSSH_USER=root\nSSH_KEY=/root/.ssh/turbo_key\nREMOTE_IMAGE_DIR=/data/bancoImagensINPI\nCH_DATABASE=neopi\n' > /content/bf/.env

echo "[4/4] pronto!"
echo "    node: $(node -v)  |  socks: $(python3 -c 'import socks;print("ok")')"
echo
echo "PROXIMOS PASSOS:"
echo "  1) suba sua chave SSH (autorizada no droplet) para /root/.ssh/turbo_key  (chmod 600)"
echo "  2) teste:  ssh -i /root/.ssh/turbo_key root@68.183.113.157 'clickhouse-client --query \"SELECT 1\"'"
echo "  3) rode:   cd /content/bf && python3 turbo/turbo.py --range A-B --ports 2 --circuits-per-port 20 \\"
echo "               --catalog /content/drive/MyDrive/turbo_catalogos/turbo_A_B.sqlite"
