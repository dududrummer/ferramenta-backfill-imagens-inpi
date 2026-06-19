# Uso — Comandos e Fluxo de Operação

## Visão geral do fluxo

```
1. Abrir túnel SSH (ClickHouse)
2. Subir instâncias Tor
3. node src/cli.js index          # (uma vez) indexar o que já existe
4. node src/cli.js run --phase 1  # baixar o que já tem tem_imagem=1 mas falta o arquivo
5. node src/cli.js run --phase 2  # sondar os demais
6. node src/cli.js status         # acompanhar progresso
```

---

## Pré-condições para qualquer comando

1. **Túnel SSH para o ClickHouse ativo** (em um terminal separado, mantê-lo aberto):
   ```bash
   ssh -L 8123:localhost:8123 deploy@seu.servidor.com -N
   ```

2. **Instâncias Tor em execução** (só necessário para `run`):
   ```bash
   bash tor/start-tor.sh
   ```

---

## Comandos

### `index`

Conecta ao servidor via SSH, executa `find <REMOTE_IMAGE_DIR> -type f -name '*.*'` e registra no catálogo local todos os arquivos que já existem no servidor como `status=baixada, uploaded=1`. Isso evita que a ferramenta tente baixar e fazer upload de arquivos que já estão lá.

**Execute uma vez antes do primeiro `run`, e novamente se houver alterações externas no diretório remoto.**

```bash
node src/cli.js index
```

Saída esperada:
```
Indexados 42137 arquivos já existentes no servidor.
```

---

### `run --phase <1|2>`

Busca candidatos no ClickHouse, filtra o que o catálogo local já registrou como processado, e baixa as imagens restantes em paralelo via pool de circuitos Tor. Após cada lote de `RSYNC_BATCH` downloads, executa um flush (rsync + marcação no DB).

**Opções:**

| Flag | Obrigatória | Descrição |
|---|---|---|
| `--phase 1` ou `--phase 2` | Sim | Seleciona a fase (ver abaixo) |
| `--range A-B` | Não (Fase 2 apenas) | Restringe os candidatos ao intervalo `n_url >= A AND n_url <= B` |
| `--concurrency N` | Não | Sobrescreve `CONCURRENCY` do `.env` para esta execução |
| `--keep-local` | Não | Não apaga o diretório de staging local após o rsync |

```bash
# Fase 1 completa
node src/cli.js run --phase 1

# Fase 2 com range e concorrência reduzida
node src/cli.js run --phase 2 --range 1-5000000 --concurrency 4

# Manter arquivos locais após o upload (útil para depuração)
node src/cli.js run --phase 1 --keep-local
```

---

### `status`

Exibe as estatísticas do catálogo local (contagem por status). Não acessa o servidor nem o ClickHouse — é instantâneo.

```bash
node src/cli.js status
```

Saída esperada (exemplo):
```json
{ "baixada": 38500, "sem_imagem": 1200, "falhou": 47 }
```

**Interpretando a saída:**

| Status | Significado |
|---|---|
| `baixada` | Imagem obtida com sucesso (pode ainda estar pendente de upload ou marcação no DB) |
| `sem_imagem` | O INPI não tem imagem para esse `n_url` (404 real ou placeholder identificado) |
| `falhou` | Esgotou as `MAX_TENTATIVAS` tentativas sem resultado definitivo; será retentado em próximas execuções se removido do catálogo |

---

### `flush`

Executa manualmente o flush: faz rsync das imagens pendentes de upload e atualiza `tem_imagem=1` no ClickHouse para os registros pendentes de marcação. Útil para forçar a sincronização sem rodar um `run` completo.

```bash
node src/cli.js flush

# Manter arquivos locais
node src/cli.js flush --keep-local
```

---

## As duas fases

### Fase 1 — alta taxa de acerto

Consulta:
```sql
SELECT DISTINCT n_url FROM neopi.marcas WHERE tem_imagem = 1 AND n_url > 0
```

São registros que o banco já diz ter imagem (`tem_imagem=1`), mas o arquivo físico pode estar faltando no servidor. A taxa de acerto é alta (o INPI realmente tem a imagem) e o custo de cada requisição é baixo. **Comece sempre pela Fase 1.**

Quando a ferramenta baixa uma imagem na Fase 1, ela **não** altera o `tem_imagem` no ClickHouse (já é 1). Só faz o upload do arquivo.

### Fase 2 — sondagem exaustiva

Consulta:
```sql
SELECT DISTINCT n_url FROM neopi.marcas WHERE tem_imagem = 0 AND n_url > 0
  [AND n_url >= A AND n_url <= B]
```

Sonda registros que o banco considera sem imagem (`tem_imagem=0`) ou desconhecidos. A taxa de acerto é menor. Quando uma imagem é encontrada, a ferramenta:
1. Salva o arquivo no staging.
2. Faz upload via rsync.
3. Executa `ALTER TABLE neopi.marcas UPDATE tem_imagem=1 WHERE n_url IN (...)` no ClickHouse.

Use `--range` para dividir o trabalho entre ambientes (WSL + Colab) sem sobreposição.

---

## Resumir após interrupção

Basta re-executar o mesmo comando. O catálogo local SQLite registra cada `n_url` processado; o filtro `filtrarPendentes` exclui automaticamente tudo que já tem `status=baixada` ou `status=sem_imagem`. Registros com `status=falhou` serão retentados.

```bash
# Interrompido? Só rodar de novo:
node src/cli.js run --phase 1
```

---

## Execução paralela: WSL + Colab

Para acelerar a Fase 2, que pode envolver milhões de registros, é possível rodar o WSL e o Colab em simultâneo. Cada ambiente deve processar um range disjunto de `n_url`:

**WSL:**
```bash
node src/cli.js run --phase 2 --range 1-5000000
```

**Colab:**
```bash
node src/cli.js run --phase 2 --range 5000001-10000000
```

Cada ambiente tem seu próprio catálogo SQLite local (`CATALOG_PATH`). Ambos fazem rsync para o mesmo diretório remoto e ambos atualizam o ClickHouse — isso é seguro porque os ranges são disjuntos.

Para descobrir o intervalo total de `n_url` a cobrir, consulte o ClickHouse antes de começar:

```sql
SELECT min(n_url), max(n_url) FROM neopi.marcas WHERE tem_imagem = 0
```
