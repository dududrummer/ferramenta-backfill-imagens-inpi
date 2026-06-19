# Arquitetura

## Mapa de módulos (`src/`)

| Módulo | Responsabilidade |
|---|---|
| `config.js` | Lê e valida variáveis de ambiente via `dotenv`; exporta objeto de configuração tipado |
| `cli.js` | Ponto de entrada; faz parse dos argumentos (`index`, `run`, `status`, `flush`); orquestra os demais módulos |
| `candidates.js` | Cria o cliente ClickHouse e implementa as queries de Fase 1 / Fase 2 e o `ALTER TABLE ... UPDATE tem_imagem=1` |
| `catalog.js` | Gerencia o SQLite local (status por `n_url`); inserção em lote dos existentes, consultas de pendentes, confirmações |
| `tor-pool.js` | Cria e gerencia o pool de circuitos Tor; round-robin de circuitos; dispara `SIGNAL NEWNYM` via ControlPort |
| `runner.js` | Loop de download de um único `n_url`: chama downloader, classifica resultado, salva staging, atualiza catálogo, aciona newnym em bloqueio |
| `downloader.js` | Realiza a requisição HTTP via `SocksProxyAgent` usando o circuito Tor designado; retorna buffer bruto |
| `image-detect.js` | Detecta extensão e calcula hash SHA-1 do buffer; identifica placeholders |
| `uploader.js` | Monta os argumentos do `rsync` e executa o upload via SSH para o servidor remoto |
| `sharding.js` | Calcula o caminho de diretório e arquivo para um dado `n_url`, seguindo o sharding em 2 níveis da aplicação |

---

## Fluxo de dados

```
ClickHouse (via túnel SSH)
  │  SELECT n_url WHERE tem_imagem=1|0
  ▼
candidates.js ──► lista de candidatos
  │
  ▼
catalog.js ──► filtrarPendentes (exclui já processados)
  │
  ▼
fila de n_url pendentes
  │
  ├─► worker 1 ──► circuito Tor 1 (SOCKS 9050)
  ├─► worker 2 ──► circuito Tor 2 (SOCKS 9052)
  │   ...
  └─► worker N ──► circuito Tor N (SOCKS 9050+2*(N-1))
        │
        ▼
     downloader.js ──► INPI (imagem ou 404/bloqueio)
        │
     [bloqueio] ──► tor-pool.js → SIGNAL NEWNYM → novo IP de saída
        │
     [sucesso]
        ▼
     sharding.js ──► LOCAL_STAGING/{nivel1}/{nivel2}/{n_url}.{ext}
        │
        ▼
     catalog.js marcar(n_url, 'baixada', {uploaded:0, marcar_db:0|1})
        │
     [a cada RSYNC_BATCH downloads ou ao final]
        ▼
     uploader.js → rsync -a -e ssh staging/ servidor:REMOTE_IMAGE_DIR/
        │
     catalog.js confirmarUpload(nUrls)
        │
     [Fase 2 apenas]
        ▼
     candidates.js marcarTemImagem(nUrls) → ALTER TABLE marcas UPDATE tem_imagem=1
        │
     catalog.js confirmarMarcacaoDb(nUrls)
```

---

## Catálogo SQLite

Localização padrão: `./catalogo.sqlite` (configurável via `CATALOG_PATH`).

### Tabela `status`

| Coluna | Tipo | Descrição |
|---|---|---|
| `n_url` | `INTEGER PRIMARY KEY` | Identificador da marca no INPI |
| `status` | `TEXT NOT NULL` | Estado do processamento (ver abaixo) |
| `ext` | `TEXT` | Extensão da imagem (`jpg`, `png`, etc.) — nulo se sem imagem |
| `tentativas` | `INTEGER DEFAULT 0` | Número de tentativas realizadas |
| `marcar_db` | `INTEGER DEFAULT 0` | `1` = precisa atualizar `tem_imagem=1` no ClickHouse ainda |
| `uploaded` | `INTEGER DEFAULT 0` | `1` = arquivo já foi enviado ao servidor via rsync |
| `erro` | `TEXT` | Mensagem de erro na última falha, se houver |
| `ts` | `INTEGER` | Timestamp Unix da última atualização |

### Valores do campo `status`

| Valor | Significado |
|---|---|
| `baixada` | Imagem obtida com sucesso (arquivo salvo em staging ou já em upload) |
| `sem_imagem` | O INPI não tem imagem para este `n_url` (404 real ou placeholder por hash) |
| `falhou` | Esgotou `MAX_TENTATIVAS` sem resultado definitivo |

### Flags

- `uploaded=0` + `status=baixada` → arquivo em staging, aguardando rsync
- `uploaded=1` → arquivo já está no servidor
- `marcar_db=1` → `n_url` precisa ser incluído no próximo `ALTER TABLE UPDATE tem_imagem=1` (só usado na Fase 2)
- `marcar_db=0` após confirmação → marcação no ClickHouse concluída

### Idempotência

O método `jaProcessado(n_url)` retorna `true` se o status for `baixada` ou `sem_imagem`. Apenas `falhou` permite retentativa. O catálogo é construído com `ON CONFLICT DO UPDATE`, portanto é seguro re-indexar ou re-executar sem perda de estado.

---

## Esquema de sharding

As imagens são armazenadas em uma hierarquia de dois níveis que **deve ser idêntica** à usada pela aplicação principal (o frontend localiza o arquivo por caminho, sem consultar o banco):

```
{base}/{nivel1}/{nivel2}/{n_url}.{ext}

Onde:
  nivel1 = floor(n_url / 1_000_000)
  nivel2 = floor(n_url / 1_000) % 1_000
```

**Implementação em `src/sharding.js`:**

```js
function dirImagem(nUrl, baseDir) {
  const nivel1 = Math.floor(nUrl / 1_000_000);
  const nivel2 = Math.floor(nUrl / 1_000) % 1_000;
  return path.join(baseDir, String(nivel1), String(nivel2));
}

function caminhoImagem(nUrl, baseDir, ext) {
  return path.join(dirImagem(nUrl, baseDir), `${nUrl}.${ext}`);
}
```

**Exemplos:**

| `n_url` | `nivel1` | `nivel2` | Caminho |
|---|---|---|---|
| `123456` | `0` | `123` | `base/0/123/123456.jpg` |
| `1500000` | `1` | `500` | `base/1/500/1500000.png` |
| `7654321` | `7` | `654` | `base/7/654/7654321.jpg` |

**Por que deve coincidir com a aplicação:** o endpoint de imagens do frontend serve os arquivos diretamente pelo caminho — não consulta o banco para descobrir onde o arquivo está. Se o sharding desta ferramenta diferir do da aplicação, os arquivos são enviados para o lugar errado e o frontend não os encontra.

A função `nUrlDeCaminho(caminho)` faz o inverso: dado um caminho retornado pelo `find` remoto, extrai o `n_url` do nome do arquivo (parte numérica antes do primeiro `.`).
