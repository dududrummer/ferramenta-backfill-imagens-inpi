# ferramenta-backfill-imagens

Ferramenta CLI standalone para backfill em massa das imagens de marcas do INPI no projeto NEOPI. Consulta o ClickHouse executando `clickhouse-client` no servidor via SSH (sem túnel), baixa cada imagem via múltiplos circuitos Tor (rotação de IP automática), armazena localmente em staging, faz upload por `rsync` via SSH para o servidor e atualiza o campo `tem_imagem` no banco — tudo de forma retomável, sem alterar o schema do banco de dados da aplicação.

## Pré-requisitos

- Node.js 20+
- `tor`, `rsync`, `openssh-client` instalados na máquina local
- Acesso SSH ao servidor de produção (o servidor já tem `clickhouse-client` instalado)

## Instalação

```bash
git clone <url-do-repositorio> ferramenta-backfill-imagens
cd ferramenta-backfill-imagens
npm install
cp .env.example .env
# edite .env com suas credenciais e configurações
```

## Uso rápido

```bash
# 1. Subir as instâncias Tor
bash tor/start-tor.sh

# 2. Indexar arquivos que já existem no servidor (só na primeira vez)
node src/cli.js index

# 3. Rodar o backfill — baixa imagens de todas as marcas não-nominativas (apresentacao != 'Nominativa')
node src/cli.js run

# 4. Checar progresso a qualquer momento
node src/cli.js status
```

Resumir após interrupção: basta re-executar o mesmo comando — o catálogo local SQLite mantém o estado e pula o que já foi processado.

## Documentação

- [Instalação detalhada (WSL e Colab)](docs/instalacao.md)
- [Configuração — variáveis de ambiente](docs/configuracao.md)
- [Uso — comandos e fluxo de operação](docs/uso.md)
- [Arquitetura e estrutura do código](docs/arquitetura.md)
- [Tor e NEWNYM — guia completo](docs/tor-e-newnym.md)
