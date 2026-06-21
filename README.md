# ferramenta-backfill-imagens

Ferramenta CLI standalone para backfill em massa das imagens de marcas do INPI no projeto NEOPI. Baixa imagens via múltiplos circuitos Tor (rotação automática de IP), mantém estado retomável em SQLite e suporta dois modos de execução: rodando **no próprio servidor** (gravação direta) ou rodando em **outra máquina** (WSL/Colab/Linux), com rsync para o servidor via SSH. O trabalho pode ser dividido por faixas de `n_url` entre múltiplas máquinas rodando em paralelo.

## Dois modos de execução

- **`MODO=servidor`**: roda no próprio servidor de produção. Executa `clickhouse-client` e `find` localmente, grava as imagens direto no `IMAGE_DIR`. Sem rsync nem SSH para operar.
- **`MODO=remoto`** (padrão): roda em outra máquina (WSL, Colab, Linux local). Acessa o ClickHouse e lista arquivos via SSH; imagens vão para um staging local e sobem por rsync. Requer `SSH_HOST`, `SSH_USER` e `SSH_KEY`.

Em ambos os modos, as imagens são baixadas do INPI via **Tor** (vários circuitos), com aquecimento de sessão (cookies) e rotação proativa de IP a cada ~18 requisições.

## Instalação rápida

```bash
git clone <url-do-repositorio> ferramenta-backfill-imagens
cd ferramenta-backfill-imagens
npm install
cp .env.example .env
# edite .env com MODO, IMAGE_DIR/REMOTE_IMAGE_DIR, SSH_*, CH_DATABASE, TOR_*
```

## Uso rápido

```bash
# 1. Subir instâncias Tor (locais à máquina que roda a ferramenta)
bash tor/start-tor.sh "9050,9052,9054,9056" "9051,9053,9055,9057"

# 2. Indexar o que já existe no servidor (só na primeira vez)
node src/cli.js index

# 3. Rodar o backfill
node src/cli.js run 2>&1 | tee run.log

# 4. Dividir o trabalho entre máquinas (ranges disjuntos)
node src/cli.js run --range 4145-3000000      # máquina A
node src/cli.js run --range 3000001-6700000   # máquina B

# 5. Checar progresso
node src/cli.js status
tail -f run.log
```

## Documentação

- [Instalação detalhada e configuração por modo](docs/instalacao.md)
- [Uso — comandos, divisão por faixas e reconciliação de tem_imagem](docs/uso.md)
- [Arquitetura e estrutura do código](docs/arquitetura.md)
- [Tor e NEWNYM — guia completo](docs/tor-e-newnym.md)
