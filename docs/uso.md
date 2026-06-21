# Uso — Comandos e Fluxo de Operação

## Visão geral do fluxo

```
1. Subir instâncias Tor
2. node src/cli.js index          # (uma vez) indexar o que já existe
3. node src/cli.js run            # baixar imagens de marcas não-nominativas ainda ausentes
4. node src/cli.js status         # acompanhar progresso
```

---

## Pré-condições para qualquer comando

1. **Instâncias Tor em execução** (só necessário para `run`):
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

### `run`

Busca no ClickHouse todas as marcas não-nominativas (`apresentacao != 'Nominativa'`), filtra o que o catálogo local já registrou como processado, e baixa as imagens restantes em paralelo via pool de circuitos Tor. Após cada lote de `RSYNC_BATCH` downloads, executa um flush (rsync + marcação no DB).

A seleção inclui todos os valores de `apresentacao` que implicam logo: Figurativa, Mista, Tridimensional, e combinações como "Nominativa e Tridimensional". Apenas `Nominativa` pura (sem logo) é excluída.

Registros já presentes no catálogo local são automaticamente pulados — basta re-executar o comando após uma interrupção.

**Opções:**

| Flag | Obrigatória | Descrição |
|---|---|---|
| `--range A-B` | Não | Restringe os candidatos ao intervalo `n_url >= A AND n_url <= B` |
| `--concurrency N` | Não | Sobrescreve `CONCURRENCY` do `.env` para esta execução |
| `--keep-local` | Não | Não apaga o diretório de staging local após o rsync |

```bash
# Baixar todas as marcas não-nominativas ainda ausentes
node src/cli.js run

# Restringir a um range de n_url (útil para execução paralela WSL + Colab)
node src/cli.js run --range 1-5000000

# Com concorrência reduzida e mantendo arquivos locais
node src/cli.js run --range 1-5000000 --concurrency 4 --keep-local
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

## Critério de seleção

A ferramenta consulta o ClickHouse via `clickhouse-client` por SSH e seleciona marcas não-nominativas:

```sql
SELECT n_url, max(tem_imagem) AS tem
FROM neopi.marcas
WHERE apresentacao != 'Nominativa' AND apresentacao != '' AND n_url > 0
GROUP BY n_url
ORDER BY n_url
```

A coluna `tem_imagem` retornada é usada para decidir se o registro precisa ser atualizado no banco após o download:

- Se `tem_imagem` já era `1` → a ferramenta apenas salva o arquivo (o banco já está correto).
- Se `tem_imagem` era `0` → após baixar a imagem, a ferramenta executa `ALTER TABLE marcas UPDATE tem_imagem=1` para o `n_url` correspondente.

---

## Log de eventos em tempo real

Ao iniciar `run`, o console imprime o caminho do arquivo de log:

```
Log de eventos (tail -f): ./eventos.log
```

Acompanhe o progresso image-a-image em outro terminal:

```bash
tail -f ./eventos.log
```

Cada linha representa uma imagem processada:

```
14:03:22 BAIXADA    n_url=449552 ext=jpg
14:03:23 SEM_IMAGEM n_url=449553
14:03:25 FALHOU     n_url=449554
14:03:30 FLUSH      enviadas 2000 imagens ao servidor
```

O arquivo é append-only (nunca truncado), seguro para leitura cross-process sem depender de SQLite WAL. O caminho padrão é ao lado do catálogo (`eventos.log`); pode ser sobrescrito via `EVENTS_LOG=` no `.env`.

---

## Resumir após interrupção

Basta re-executar o mesmo comando. O catálogo local SQLite registra cada `n_url` processado; o filtro `filtrarPendentes` exclui automaticamente tudo que já tem `status=baixada` ou `status=sem_imagem`. Registros com `status=falhou` serão retentados.

```bash
# Interrompido? Só rodar de novo:
node src/cli.js run
```

---

## Execução paralela: WSL + Colab

Para acelerar o processamento de grandes volumes, é possível rodar o WSL e o Colab em simultâneo. Cada ambiente deve processar um range disjunto de `n_url`:

**WSL:**
```bash
node src/cli.js run --range 1-5000000
```

**Colab:**
```bash
node src/cli.js run --range 5000001-10000000
```

Cada ambiente tem seu próprio catálogo SQLite local (`CATALOG_PATH`). Ambos fazem rsync para o mesmo diretório remoto e ambos atualizam o ClickHouse — isso é seguro porque os ranges são disjuntos.

Para descobrir o intervalo total de `n_url` a cobrir, consulte o ClickHouse antes de começar:

```sql
SELECT min(n_url), max(n_url) FROM neopi.marcas
WHERE apresentacao != 'Nominativa' AND apresentacao != '' AND n_url > 0
```
