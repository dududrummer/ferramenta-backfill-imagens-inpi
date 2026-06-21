# Uso — Comandos e Fluxo de Operação

## Visão geral do fluxo

```
1. Subir instâncias Tor
2. node src/cli.js index          # (uma vez) indexar o que já existe no servidor
3. node src/cli.js run            # baixar imagens de marcas não-nominativas ainda ausentes
4. node src/cli.js status         # acompanhar progresso
5. (periodicamente) reconciliação de tem_imagem no ClickHouse
```

---

## Pré-condição: Tor em execução

Antes de qualquer `run`, as instâncias Tor precisam estar no ar:

```bash
bash tor/start-tor.sh "9050,9052,9054,9056" "9051,9053,9055,9057"
```

Confirme:
```bash
pgrep -x tor | wc -l   # deve mostrar 4
```

O Tor é **local à máquina que roda a ferramenta** — seja o servidor (`MODO=servidor`) ou a máquina local (`MODO=remoto`). Ele baixa as imagens do INPI via múltiplos circuitos, rotacionando o IP a cada ~18 requisições para evitar bloqueio.

---

## Comandos

### `index`

Lista os arquivos que já existem no servidor (via `find` local em `MODO=servidor`, ou via SSH em `MODO=remoto`) e registra no catálogo local. Execute uma vez antes do primeiro `run`.

```bash
node src/cli.js index
```

Saída esperada:
```
Indexados 42137 arquivos já existentes.
```

---

### `run`

Varre todos os `n_url` de **4145** até **MAX** (o maior `n_url` em `marcas`), tentando baixar a imagem de cada um. São pulados:

- `n_url`s com `apresentacao = 'Nominativa'` (não têm logotipo);
- `n_url`s cujo arquivo já existe no servidor (verificado via `find` no início de cada `run`);
- `n_url`s marcados como `sem_imagem` no catálogo local.

**Cada imagem gera uma linha no stdout** (BAIXADA / SEM_IMAGEM / FALHOU / FLUSH). Capture com `tee` e acompanhe em tempo real:

```bash
node src/cli.js run 2>&1 | tee -a run.log

# Em outro terminal:
tail -f run.log
```

Exemplo de saída:
```
14:03:22 BAIXADA    n_url=449552 ext=jpg
14:03:23 SEM_IMAGEM n_url=449553
14:03:25 FALHOU     n_url=449554
14:03:30 FLUSH      enviadas 2000 imagens ao servidor
```

A cada `RSYNC_BATCH` downloads (`MODO=remoto`), as imagens são enviadas ao servidor por rsync. Em `MODO=servidor` as imagens já vão direto para `IMAGE_DIR`.

**Opções:**

| Flag | Descrição |
|---|---|
| `--range A-B` | Restringe a varredura ao intervalo `n_url >= A AND n_url <= B` |
| `--concurrency N` | Sobrescreve `CONCURRENCY` do `.env` para esta execução |
| `--keep-local` | Não apaga o staging local após o rsync (`MODO=remoto`) |

```bash
# Toda a faixa 4145 → MAX (padrão)
node src/cli.js run

# Range específico (útil para dividir entre máquinas — veja seção abaixo)
node src/cli.js run --range 4145-3000000

# Com concorrência reduzida
node src/cli.js run --range 4145-3000000 --concurrency 4
```

**Retomar após interrupção:** basta re-executar o mesmo comando. O catálogo SQLite local preserva o estado; o `run` faz um novo `find` no servidor no início e constrói o conjunto de skip atualizado.

---

### `status`

Exibe as estatísticas do catálogo local. Não acessa o servidor nem o ClickHouse — é instantâneo.

```bash
node src/cli.js status
```

Saída esperada:
```json
{ "baixada": 38500, "sem_imagem": 1200, "falhou": 47 }
```

| Status | Significado |
|---|---|
| `baixada` | Imagem obtida com sucesso |
| `sem_imagem` | O INPI não tem imagem para esse `n_url` (404 real ou placeholder) |
| `falhou` | Esgotou as `MAX_TENTATIVAS` tentativas; será retentado em próximas execuções |

---

### `flush`

Executa manualmente o rsync das imagens pendentes de upload (apenas `MODO=remoto`). Útil para forçar a sincronização sem rodar um `run` completo.

```bash
node src/cli.js flush

# Manter arquivos no staging local após o rsync
node src/cli.js flush --keep-local
```

---

## Dividir o trabalho entre máquinas com `--range`

O `--range A-B` limita a faixa de `n_url` processada por cada instância. Use isso para paralelizar o backfill entre o servidor, o WSL e/ou o Colab — cada máquina trabalha em um segmento disjunto.

**Exemplo prático** (MAX = 6.700.000):

| Máquina | Comando |
|---|---|
| Servidor (MODO=servidor) | `node src/cli.js run --range 4145-3000000` |
| WSL local (MODO=remoto) | `node src/cli.js run --range 3000001-5000000` |
| Colab (MODO=remoto) | `node src/cli.js run --range 5000001-6700000` |

Cada máquina tem seu **próprio catálogo SQLite local** (`CATALOG_PATH`). Todas escrevem imagens no mesmo diretório do servidor (direto via `IMAGE_DIR` no modo servidor, ou via rsync no modo remoto) — isso é seguro porque os ranges são disjuntos.

Para descobrir o MAX atual antes de distribuir as faixas:
```bash
# No servidor (ou via SSH)
clickhouse-client --query "SELECT max(n_url) FROM neopi.marcas"
```

O FLOOR fixo da ferramenta é 4145 — não use valores menores que isso no `--range`.

---

## Acompanhar progresso

```bash
# Contagem de linhas no log (imagens tentadas)
wc -l run.log

# Contagem de imagens no servidor (MODO=servidor ou via SSH)
find /var/neopi/bancoImagensINPI -type f | wc -l

# Via SSH (MODO=remoto)
ssh deploy@seu.servidor.com "find /var/neopi/bancoImagensINPI -type f | wc -l"

# Status do catálogo local
node src/cli.js status
```

---

## Reconciliação do `tem_imagem` no ClickHouse

Por padrão, `MARCAR_TEM_IMAGEM=0` — o campo `tem_imagem` na tabela `marcas` **não é atualizado durante o download**. Isso porque `n_url` não é a sort key da tabela, e cada `UPDATE` varre a tabela inteira, o que é muito pesado em produção.

A abordagem recomendada é uma **reconciliação periódica**, executada diretamente no servidor de produção. O processo gera a lista de arquivos presentes, insere numa tabela temporária em memória e faz um único `ALTER ... UPDATE` em lote:

```bash
# Execute no servidor de produção (como o usuário que tem acesso ao clickhouse-client)

# 1. Listar todos os n_url que têm arquivo (extraindo o nome sem extensão)
find /var/neopi/bancoImagensINPI -type f -printf '%f\n' | sed 's/\.[^.]*$//' > /tmp/imgs.tsv

# 2. Criar e limpar a tabela temporária em memória
clickhouse-client --query "CREATE TABLE IF NOT EXISTS neopi.imgs_tmp (n_url UInt32) ENGINE=Memory"
clickhouse-client --query "TRUNCATE TABLE neopi.imgs_tmp"

# 3. Inserir os n_url presentes
clickhouse-client --query "INSERT INTO neopi.imgs_tmp FORMAT TSV" < /tmp/imgs.tsv

# 4. Atualizar tem_imagem=1 em lote (aguarda a mutação completar)
clickhouse-client --query "ALTER TABLE neopi.marcas UPDATE tem_imagem=1 WHERE tem_imagem=0 AND n_url IN (SELECT n_url FROM neopi.imgs_tmp) SETTINGS mutations_sync=1"

# 5. Limpar
clickhouse-client --query "DROP TABLE neopi.imgs_tmp"
```

Execute este bloco de tempos em tempos durante o backfill e ao final. O `mutations_sync=1` garante que o comando só retorna quando a mutação terminou.

> Se preferir o update inline a cada download, defina `MARCAR_TEM_IMAGEM=1` no `.env` — mas esteja ciente do impacto de performance em produção.

---

## Critério de seleção

A ferramenta percorre todos os `n_url` de 4145 até `max(n_url)` da tabela `marcas`. Antes de iniciar a varredura, carrega em memória:

1. **Nominativas** — `n_url`s onde `apresentacao = 'Nominativa'` (não têm logotipo; pulados).
2. **Já no servidor** — `n_url`s cujo arquivo já existe (via `find` local em `MODO=servidor`, ou via SSH em `MODO=remoto`). Fonte de verdade absoluta.
3. **Sem imagem** — `n_url`s marcados como `sem_imagem` no catálogo local SQLite (INPI confirmou ausência).

Para cada `n_url` da faixa que não esteja em nenhum desses conjuntos, a ferramenta tenta baixar a imagem. Isso captura inclusive registros cujo `n_url` existe no INPI mas ainda não foi importado para `marcas` (buracos de importação).
