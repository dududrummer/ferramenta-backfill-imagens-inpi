# Turbo scraper (Python + Tor) — design

## Objetivo
Script standalone que roda em **WSL / Colab / servidor**, recebe a **faixa por argumento**, raspa a
**página completa de detalhe** do INPI por Tor de forma **muito rápida**, e grava nas tabelas de
**staging `*_rerasp`** — produzindo dados **idênticos** aos da carga manual (sem conflito no banco).
Sem imagens.

## Princípio de paridade (decisão nº1)
Só o que toca o banco (parse + insert) fica em **Node**, reusando o `src/parser-html.js`
(`parseDetailFull`) e o `src/ch-stage.js` (`criarStager`) — a mesma fonte de verdade da carga
manual. O **Python** só faz fetch pelo Tor, classifica e orquestra. Impossível divergir.

## Componentes
- **`turbo/turbo.py`** — driver Python (`requests` + threads):
  - sobe o Tor sozinho (torrc otimizado), 1 instância por porta;
  - **20 circuitos isolados por porta** (usuário SOCKS distinto por worker → `IsolateSOCKSAuth`);
  - warm da sessão pePI (4 reqs) reusada por circuito; fetch `Action=detail&CodPedido=<n_url>`;
  - classifica `ok/sem_dados/inexistente/bloqueio/sessao` (igual `detalhe.js`);
  - retry 3x (rotação de circuito entre tentativas); catálogo sqlite retomável;
  - a cada 2000 `ok` chama o helper Node para parsear+gravar.
- **`turbo/parse_insert.js`** — lê um lote de HTMLs já buscados, `parseDetailFull` em cada,
  `stager.add`, `stager.flush()` → `*_rerasp` via SSH `clickhouse-client`. Devolve `{ok,fail}`.

## Pipeline (produtor/consumidor)
`feeder` (enumera a faixa, pula `gravado`/`sem_dados`) → `N workers` (1 por circuito, fetch+retry) →
`writer` (1 só: marca terminais no catálogo, junta os `ok` em lote de 2000, chama o Node, marca
`gravado`). Filas limitadas dão backpressure. Só o `writer` toca catálogo/Node → sem locks.

## Semântica de retry (combinado com o usuário)
- `erro`, `sem_dados`, `sessao`, `bloqueio` → retenta até 3x (rotaciona o circuito entre tentativas).
- `inexistente` ("Erro: Pedido inexistente!") → **terminal** `sem_dados` (resposta definitiva do INPI;
  re-tentar não muda — evita gastar 3x em buracos reais).
- Esgotou 3x: último era `sem_dados` → marca `sem_dados`; senão → marca `falhou`.
- `falhou` **não é buraco**: o `feeder` só pula `gravado`/`sem_dados`, então um passe futuro o retoma
  (igual ao `proximo()` da aplicação).

## Tor otimizado
torrc por instância: `IsolateSOCKSAuth`, `UseEntryGuards 0`, `LearnCircuitBuildTimeout 0`,
`CircuitBuildTimeout 10`, `CircuitStreamTimeout 10`, `ConnectionPadding 0`, `MaxCircuitDirtiness 600`.
Rotação por **troca de usuário SOCKS** (novo circuito isolado, sem precisar de ControlPort/NEWNYM).

## Banco / conexão
Grava em `*_rerasp` via `ch-stage` (SSH + `clickhouse-client`), reusando o `.env` da ferramenta
(SSH/CH). O helper seta `TOR_SOCKS_PORTS` dummy só para satisfazer o `carregarConfig` (ele só insere).

## CLI
`python3 turbo/turbo.py --range A-B [--ports 3] [--circuits-per-port 20] [--base-port 9050]
[--flush 2000] [--max-tentativas 3] [--catalog PATH] [--tor-data DIR] [--no-tor]`

## Fora de escopo
Imagens; merge/swap (continua sendo o `rerasp-merge.js`); alterar o parser (reusa o existente).
