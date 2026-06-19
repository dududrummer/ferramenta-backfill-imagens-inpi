# Instalação

## WSL (ambiente principal)

### 1. Dependências do sistema

```bash
sudo apt-get update
sudo apt-get install -y tor rsync openssh-client
```

> **Nota sobre `better-sqlite3`:** esse pacote compilado nativamente exige ferramentas de build (`python3`, `make`, `g++`). No WSL com uma imagem Ubuntu/Debian padrão elas já estão presentes. Se receber erro de compilação, instale:
> ```bash
> sudo apt-get install -y build-essential python3
> ```
> No Windows nativo (fora do WSL) seria necessário o "Visual Studio Build Tools" — use o WSL para evitar esse problema.

### 2. Clonar e instalar dependências Node

```bash
git clone <url-do-repositorio> ferramenta-backfill-imagens
cd ferramenta-backfill-imagens
npm install
```

### 3. Configurar acesso SSH ao servidor

A ferramenta usa SSH de duas formas: túnel para o ClickHouse e `rsync` / `find` remoto. Recomenda-se uma chave SSH dedicada:

```bash
# Gerar chave (ou reutilizar uma existente)
ssh-keygen -t ed25519 -f ~/.ssh/id_neopi_backfill -C "backfill-imagens"

# Copiar a chave pública para o servidor
ssh-copy-id -i ~/.ssh/id_neopi_backfill.pub deploy@seu.servidor.com

# Testar
ssh -i ~/.ssh/id_neopi_backfill deploy@seu.servidor.com echo OK
```

Adicione a configuração ao `~/.ssh/config` para facilitar o uso:

```
Host neopi-prod
    HostName seu.servidor.com
    User deploy
    IdentityFile ~/.ssh/id_neopi_backfill
```

### 4. Configurar `.env`

```bash
cp .env.example .env
```

Edite `.env` com os valores reais. Veja [docs/configuracao.md](configuracao.md) para a referência completa de cada variável.

Valores mínimos obrigatórios:

```dotenv
SSH_HOST=seu.servidor.com
SSH_USER=deploy
SSH_KEY=~/.ssh/id_neopi_backfill
REMOTE_IMAGE_DIR=/var/neopi/bancoImagensINPI
```

### 5. Verificar instalação

```bash
# Checar que o Node correto está disponível
node --version   # deve ser >= 20

# Checar que o tor está instalado
tor --version

# Checar que o rsync está disponível
rsync --version
```

---

## Google Colab (execução paralela com range distinto)

O Colab pode rodar uma segunda instância da ferramenta em paralelo com o WSL, usando um `--range` de `n_url` diferente para que os dois não processem os mesmos registros.

Cole o bloco abaixo em uma célula de código:

```python
%%bash
# 1. Instalar dependências do sistema
apt-get update -q
apt-get install -y -q tor rsync openssh-client build-essential python3

# 2. Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -q nodejs

# 3. Clonar o repositório
git clone <url-do-repositorio> /content/backfill
cd /content/backfill

# 4. Instalar dependências npm
npm install

# 5. Criar .env (edite os valores antes de rodar)
cat > /content/backfill/.env << 'EOF'
SSH_HOST=seu.servidor.com
SSH_USER=deploy
SSH_KEY=/root/.ssh/id_neopi_backfill
REMOTE_IMAGE_DIR=/var/neopi/bancoImagensINPI
CH_HOST=localhost
CH_PORT=8123
CH_DATABASE=neopi
CH_USER=default
CH_PASSWORD=
TOR_SOCKS_PORTS=9050,9052,9054,9056
TOR_CONTROL_PORTS=9051,9053,9055,9057
TOR_CONTROL_PASSWORD=
CONCURRENCY=8
RATE_PER_CIRCUIT=2
MAX_TENTATIVAS=3
TIMEOUT_MS=30000
LOCAL_STAGING=./staging
CATALOG_PATH=./catalogo.sqlite
RSYNC_BATCH=2000
CH_UPDATE_BATCH=5000
PLACEHOLDER_HASHES=
EOF

# 6. Configurar chave SSH (cole o conteúdo da sua chave privada)
mkdir -p /root/.ssh
# Substitua o bloco abaixo pelo conteúdo real da chave privada:
cat > /root/.ssh/id_neopi_backfill << 'CHAVE'
-----BEGIN OPENSSH PRIVATE KEY-----
<cole aqui o conteúdo da chave privada>
-----END OPENSSH PRIVATE KEY-----
CHAVE
chmod 600 /root/.ssh/id_neopi_backfill

# 7. Adicionar servidor ao known_hosts
ssh-keyscan -H seu.servidor.com >> /root/.ssh/known_hosts 2>/dev/null

# 8. Subir Tor
cd /content/backfill
bash tor/start-tor.sh

echo "Pronto para rodar"
```

Em seguida, abrir o túnel SSH para o ClickHouse em background e executar com um range exclusivo para o Colab (por exemplo, o WSL processa 1–5000000 e o Colab processa 5000001–10000000):

```python
%%bash
cd /content/backfill

# Tunnel ClickHouse em background
ssh -i /root/.ssh/id_neopi_backfill -L 8123:localhost:8123 \
    deploy@seu.servidor.com -N -f -o StrictHostKeyChecking=accept-new

# Indexar arquivos existentes (só na primeira vez)
node src/cli.js index

# Rodar Fase 2 com range exclusivo para este ambiente
node src/cli.js run --phase 2 --range 5000001-10000000
```

> **Importante:** o range do Colab deve ser disjunto do range do WSL para evitar processamento duplicado. Use o comando `status` em cada ambiente para acompanhar o progresso de forma independente.
