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

Varre todos os `n_url` de 4145 até `MAX` (o maior `n_url` em `marcas`), tentando baixar a imagem de cada um. São pulados:

- `n_url`s que o ClickHouse marca como `apresentacao='Nominativa'` (não têm logo);
- `n_url`s já presentes no catálogo local (processados com sucesso ou marcados como sem imagem).

Isso captura imagens de registros com `n_url` que existem no INPI mas ainda não estão na tabela `marcas` (buracos de importação). Após cada lote de `RSYNC_BATCH` downloads, executa um flush (rsync ao servidor remoto).

Os conjuntos de nominativas e de já-processados são carregados uma vez em memória (Sets) e a faixa é percorrida em stream — sem construir um array gigante.

Registros já presentes no catálogo local são automaticamente pulados — basta re-executar o comando após uma interrupção.

**Rotação proativa de IP:** cada circuito rotaciona o IP de saída automaticamente a cada ~18 requisições (`MAX_REQ_POR_CIRCUITO`) para ficar abaixo do limite do INPI (~20/IP), evitando bloqueios; a sessão só é re-aquecida se o INPI a invalidar (302).

**Marcação `tem_imagem` no ClickHouse:** desligada por padrão (cada UPDATE varre a tabela toda porque `n_url` não é a chave de ordenação). Para habilitar: `MARCAR_TEM_IMAGEM=1` no `.env`.

**Opções:**

| Flag | Obrigatória | Descrição |
|---|---|---|
| `--range A-B` | Não | Restringe a varredura ao intervalo `n_url >= A AND n_url <= B` (útil para chunking em paralelo ou para limitar uso de memória) |
| `--concurrency N` | Não | Sobrescreve `CONCURRENCY` do `.env` para esta execução |
| `--keep-local` | Não | Não apaga o diretório de staging local após o rsync |

```bash
# Varrer toda a faixa 4145→MAX (padrão)
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

A ferramenta percorre todos os `n_url` de 4145 até `max(n_url)` da tabela `marcas`. Antes de iniciar a varredura, carrega dois Sets em memória via SSH:

1. **Nominativas** — `n_url`s onde `apresentacao = 'Nominativa'` (não têm logo; pulados):
   ```sql
   SELECT n_url FROM neopi.marcas WHERE apresentacao = 'Nominativa'
   ```

2. **Já processados** — todos os `n_url` registrados no catálogo local SQLite.

Para cada `n_url` da faixa que não esteja em nenhum dos dois conjuntos, a ferramenta tenta baixar a imagem do INPI. Isso captura registros que existem no INPI mas cujo `n_url` ainda não foi importado para a tabela `marcas` (buracos).

**Marcação `tem_imagem`:** controlada pela variável `MARCAR_TEM_IMAGEM`. Quando `=1`, após cada download bem-sucedido a ferramenta executa `ALTER TABLE marcas UPDATE tem_imagem=1` para o `n_url` correspondente. O padrão é `0` (desligado) porque `n_url` não é a chave de ordenação da tabela, e cada UPDATE varre a tabela inteira — pesado em produção.

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

Basta re-executar o mesmo comando. O catálogo local SQLite registra cada `n_url` processado; o Set de já-processados é carregado no início da varredura e exclui automaticamente tudo que já tem qualquer status registrado. Registros com `status=falhou` serão retentados (não estão nos conjuntos de skip).

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
SELECT max(n_url) FROM neopi.marcas
```

O `min` fixo é 4145 (FLOOR da ferramenta). O `max` é o maior `n_url` já importado; a ferramenta busca automaticamente se `--range` não for especificado.
