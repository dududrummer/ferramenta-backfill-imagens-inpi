# Instalação

Este guia cobre a instalação da ferramenta para os dois modos de execução suportados.

---

## Dois modos de execução

| Aspecto | `MODO=servidor` | `MODO=remoto` (padrão) |
|---|---|---|
| **Onde roda** | No próprio servidor de produção | Outra máquina: WSL, Colab, Linux local |
| **ClickHouse** | `clickhouse-client` local | `clickhouse-client` via SSH no servidor |
| **`find`** | Executado localmente no servidor | Executado via SSH no servidor |
| **Imagens** | Gravadas direto em `IMAGE_DIR` | Staging local → rsync para o servidor |
| **Tor** | Local ao servidor | Local à máquina que roda a ferramenta |

---

## Dependências por modo

| Pacote | Comum a ambos | Só `servidor` | Só `remoto` |
|---|---|---|---|
| Node.js 20+ (nativo Linux) | X | | |
| `git` | X | | |
| `tor` | X | | |
| `clickhouse-client` | | X (já presente no servidor ClickHouse) | |
| `build-essential` + `python3` | X | | |
| `rsync` | | | X |
| `openssh-client` | | | X |
| Acesso SSH ao servidor | | | X |

> `build-essential` e `python3` são necessários para compilar o `better-sqlite3`. Em imagens Ubuntu/Debian padrão eles costumam estar presentes. Se `npm install` falhar com erro de compilação, instale:
> ```bash
> sudo apt-get install -y build-essential python3
> ```

---

## Instalação (passos comuns a ambos os modos)

### 1. Instalar dependências do sistema

**Modo remoto (WSL/Colab/Linux):**
```bash
sudo apt-get update
sudo apt-get install -y tor rsync openssh-client build-essential python3
```

**Modo servidor (no servidor de produção):**
```bash
sudo apt-get update
sudo apt-get install -y tor build-essential python3
# rsync e openssh-client não são necessários para a operação da ferramenta
```

### 2. Instalar Node.js 20+

Se o Node não estiver presente (comum em Colab ou servidores limpos):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
node --version   # deve mostrar v20.x ou superior
```

### 3. Clonar o repositório e instalar dependências npm

```bash
git clone <url-do-repositorio> ferramenta-backfill-imagens
cd ferramenta-backfill-imagens
npm install
```

### 4. Copiar e editar o `.env`

```bash
cp .env.example .env
# edite .env com os valores do seu ambiente
```

Veja as seções abaixo para os valores específicos de cada modo.

---

## Configurar o `.env` — Modo servidor

Use quando a ferramenta roda **no próprio servidor** onde as imagens ficam armazenadas.

```dotenv
MODO=servidor

# IMAGE_DIR: caminho local (no servidor) onde as imagens são gravadas
IMAGE_DIR=/var/neopi/bancoImagensINPI

# REMOTE_IMAGE_DIR deve ter o mesmo valor que IMAGE_DIR (campo obrigatório pelo código)
REMOTE_IMAGE_DIR=/var/neopi/bancoImagensINPI

# SSH_HOST e SSH_USER também precisam ser preenchidos (o código os lê na
# inicialização mesmo em modo servidor). Use os valores reais ou qualquer valor
# não-vazio — eles não são usados para executar comandos neste modo.
SSH_HOST=localhost
SSH_USER=deploy
SSH_KEY=

# ClickHouse: executado localmente via clickhouse-client
CH_DATABASE=neopi

# Caminhos locais — escolha diretórios graváveis no servidor
CATALOG_PATH=/var/neopi/backfill/catalogo.sqlite
LOCAL_STAGING=/var/neopi/backfill/staging

# Tor
TOR_SOCKS_PORTS=9050,9052,9054,9056
TOR_CONTROL_PORTS=9051,9053,9055,9057
TOR_CONTROL_PASSWORD=

# Concorrência (ajuste conforme CPU/rede do servidor)
CONCURRENCY=8
```

Variáveis que **não têm efeito** em `MODO=servidor`: `rsync`, upload remoto — as imagens vão direto para `IMAGE_DIR`.

---

## Configurar o `.env` — Modo remoto

Use quando a ferramenta roda em **outra máquina** (WSL, Colab, Linux local) e o servidor fica em outro host.

```dotenv
MODO=remoto

# SSH para o servidor de produção
SSH_HOST=seu.servidor.com
SSH_USER=deploy
SSH_KEY=~/.ssh/id_neopi_backfill
SSH_PORT=22

# Caminho das imagens NO SERVIDOR (destino do rsync)
REMOTE_IMAGE_DIR=/var/neopi/bancoImagensINPI

# IMAGE_DIR pode ser deixado em branco no modo remoto
IMAGE_DIR=

# ClickHouse: executado no servidor via SSH
CH_DATABASE=neopi

# Caminhos LOCAIS (na máquina onde a ferramenta roda)
# ATENÇÃO WSL: use o FS nativo do Linux (ver seção abaixo), NUNCA /mnt/...
LOCAL_STAGING=~/backfill/staging
CATALOG_PATH=~/backfill/catalogo.sqlite

# Tor
TOR_SOCKS_PORTS=9050,9052,9054,9056
TOR_CONTROL_PORTS=9051,9053,9055,9057
TOR_CONTROL_PASSWORD=

CONCURRENCY=8
```

### Configurar acesso SSH (modo remoto)

```bash
# Gerar uma chave dedicada (ou reutilizar uma existente)
ssh-keygen -t ed25519 -f ~/.ssh/id_neopi_backfill -C "backfill-imagens"

# Copiar a chave pública para o servidor
ssh-copy-id -i ~/.ssh/id_neopi_backfill.pub deploy@seu.servidor.com

# Testar
ssh -i ~/.ssh/id_neopi_backfill deploy@seu.servidor.com echo OK
```

Opcional — adicionar ao `~/.ssh/config`:
```
Host neopi-prod
    HostName seu.servidor.com
    User deploy
    IdentityFile ~/.ssh/id_neopi_backfill
```

---

## Atenção: WSL

Se você rodar no WSL (Windows Subsystem for Linux), **use sempre o sistema de arquivos nativo do Linux** para `LOCAL_STAGING` e `CATALOG_PATH`. Nunca use caminhos `/mnt/c/...` ou `/mnt/d/...` porque:

- O SQLite (`better-sqlite3`) pode ter problemas de permissão e bloqueio de arquivo em sistemas de arquivos montados do Windows.
- O `start-tor.sh` exige `chmod 700` no diretório de dados do Tor — esse chmod não funciona em `/mnt`.

**Use caminhos como:**
```
CATALOG_PATH=~/backfill/catalogo.sqlite
LOCAL_STAGING=~/backfill/staging
```

Certifique-se também de que está usando o **Node.js nativo do Linux** instalado dentro do WSL, não o Node.js do Windows:
```bash
which node    # deve mostrar /usr/bin/node ou /usr/local/bin/node, nunca /mnt/c/...
node --version
```

---

## Subir o Tor

O Tor é local à máquina que roda a ferramenta (seja o servidor em `MODO=servidor`, seja a máquina local em `MODO=remoto`).

O script `tor/start-tor.sh` sobe N instâncias Tor com pares de portas SOCKS/CONTROL. Cada instância fica em um processo separado usando `setsid` — o que significa que **sobrevive ao fechar o terminal**.

```bash
bash tor/start-tor.sh "9050,9052,9054,9056" "9051,9053,9055,9057"
```

O script aguarda 45 segundos para o bootstrap e então imprime quantas instâncias estão vivas. Confirme com:

```bash
pgrep -x tor | wc -l   # deve mostrar 4 (ou o número de portas configurado)
```

Os logs de cada instância ficam em `~/.neopi-tor/tor<porta>.log` (ou no `TOR_DATA_DIR` se você sobrescreveu).

> Para usar um diretório de dados diferente (útil no servidor, para separar das eventuais instâncias Tor do sistema):
> ```bash
> TOR_DATA_DIR=/var/neopi/tor-data bash tor/start-tor.sh "9050,9052,9054,9056" "9051,9053,9055,9057"
> ```

---

## Verificar instalação

```bash
node --version        # >= 20
tor --version
git --version
node src/cli.js       # deve imprimir: Comandos: index | run [...] | status | flush
```

---

## Google Colab

Para rodar no Colab (modo remoto, com range de n_url exclusivo para não colidir com outra máquina), cole em uma célula:

```python
%%bash
# Dependências do sistema
apt-get update -q
apt-get install -y -q tor rsync openssh-client build-essential python3

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -q nodejs

# Repositório
git clone <url-do-repositorio> /content/backfill
cd /content/backfill
npm install

# .env
cat > /content/backfill/.env << 'EOF'
MODO=remoto
SSH_HOST=seu.servidor.com
SSH_USER=deploy
SSH_KEY=/root/.ssh/id_neopi_backfill
REMOTE_IMAGE_DIR=/var/neopi/bancoImagensINPI
CH_DATABASE=neopi
TOR_SOCKS_PORTS=9050,9052,9054,9056
TOR_CONTROL_PORTS=9051,9053,9055,9057
TOR_CONTROL_PASSWORD=
CONCURRENCY=8
MAX_REQ_POR_CIRCUITO=18
LOCAL_STAGING=/content/staging
CATALOG_PATH=/content/catalogo.sqlite
RSYNC_BATCH=2000
MARCAR_TEM_IMAGEM=0
EOF

# Chave SSH (substitua pelo conteúdo real da chave privada)
mkdir -p /root/.ssh
cat > /root/.ssh/id_neopi_backfill << 'CHAVE'
-----BEGIN OPENSSH PRIVATE KEY-----
<cole aqui o conteúdo da chave privada>
-----END OPENSSH PRIVATE KEY-----
CHAVE
chmod 600 /root/.ssh/id_neopi_backfill
ssh-keyscan -H seu.servidor.com >> /root/.ssh/known_hosts 2>/dev/null

# Tor
cd /content/backfill
bash tor/start-tor.sh "9050,9052,9054,9056" "9051,9053,9055,9057"

echo "Pronto."
```
