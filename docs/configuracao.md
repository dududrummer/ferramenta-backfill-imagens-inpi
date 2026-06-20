# Configuração — Variáveis de Ambiente

Copie `.env.example` para `.env` e edite os valores. O arquivo é carregado automaticamente via `dotenv` na inicialização.

---

## Grupo SSH

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `SSH_HOST` | Sim | — | Hostname ou IP do servidor de produção |
| `SSH_USER` | Sim | — | Usuário SSH no servidor |
| `SSH_KEY` | Não | `null` (usa o agente SSH) | Caminho para a chave privada SSH (ex: `~/.ssh/id_ed25519`) |
| `SSH_PORT` | Não | `22` | Porta SSH do servidor |
| `REMOTE_IMAGE_DIR` | Sim | — | Caminho absoluto no servidor onde as imagens ficam (ex: `/var/neopi/bancoImagensINPI`) |

---

## Grupo ClickHouse

O ClickHouse é consultado executando `clickhouse-client` no servidor via SSH (o servidor já tem o cliente instalado); não há túnel. Só `CH_DATABASE` é usado.

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `CH_DATABASE` | Não | `neopi` | Nome do banco de dados no ClickHouse |

---

## Grupo Tor

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `TOR_HOST` | Não | `127.0.0.1` | Host onde as instâncias Tor estão escutando |
| `TOR_SOCKS_PORTS` | Sim | — | Lista de portas SOCKS separadas por vírgula, uma por instância Tor (ex: `9050,9052,9054,9056`) |
| `TOR_CONTROL_PORTS` | Sim | — | Lista de portas Control separadas por vírgula, mesma ordem que `TOR_SOCKS_PORTS` (ex: `9051,9053,9055,9057`) |
| `TOR_CONTROL_PASSWORD` | Não | `""` (vazio) | Senha de autenticação do ControlPort (deixar vazio se o torrc não configurar senha) |

> **Atenção:** `TOR_SOCKS_PORTS` e `TOR_CONTROL_PORTS` devem ter **o mesmo número de entradas**. A ferramenta validará isso na inicialização e encerrará com erro se os tamanhos diferirem.

O script `tor/start-tor.sh` usa por padrão as portas `9050,9052,9054,9056` (SOCKS) e `9051,9053,9055,9057` (Control), que correspondem aos valores de exemplo no `.env.example`. Caso use portas diferentes, passe-as como argumentos para o script:

```bash
bash tor/start-tor.sh "9060,9062" "9061,9063"
```

---

## Grupo Execução

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `CONCURRENCY` | Não | `8` | Número de workers em paralelo (downloads simultâneos). Pode ser sobrescrito em tempo de execução com `--concurrency N`. |
| `RATE_PER_CIRCUIT` | Não | `2` | Requisições por segundo por circuito Tor. Limita o ritmo para evitar bloqueios. |
| `MAX_TENTATIVAS` | Não | `3` | Número máximo de tentativas por `n_url` antes de marcá-lo como `falhou`. |
| `TIMEOUT_MS` | Não | `30000` | Timeout em milissegundos para cada requisição HTTP via Tor. |
| `LOCAL_STAGING` | Não | `./staging` | Diretório local de staging onde as imagens são salvas antes do upload. |
| `CATALOG_PATH` | Não | `./catalogo.sqlite` | Caminho para o arquivo SQLite do catálogo de estado local. |
| `RSYNC_BATCH` | Não | `2000` | Número de downloads bem-sucedidos que dispara um flush intermediário (rsync + marcação no DB). |
| `CH_UPDATE_BATCH` | Não | `5000` | Tamanho do lote para o `ALTER TABLE ... UPDATE tem_imagem=1` no ClickHouse. |

### Tradeoff: velocidade vs. bloqueio

- **`CONCURRENCY` alto** aumenta o throughput mas eleva o risco de bloqueio por IP — ao mesmo tempo que múltiplos circuitos Tor ajudam, cada circuito individual ainda faz mais requisições.
- **`RATE_PER_CIRCUIT` alto** também aumenta o throughput, mas pode disparar bloqueios mais rapidamente em um circuito específico.
- Para uma primeira execução estável, os padrões (`CONCURRENCY=8`, `RATE_PER_CIRCUIT=2`) são um bom ponto de partida. Se houver muitos erros `bloqueio`, reduza ambos.

---

## Grupo Placeholder

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `PLACEHOLDER_HASHES` | Não | `""` (vazio) | Lista de hashes SHA-1 separados por vírgula, correspondentes às imagens "sem logo" que o INPI retorna para marcas sem imagem real. Quando uma imagem baixada tem um desses hashes, ela é tratada como `sem_imagem`. Preencher após validação manual de quais imagens são placeholders. |
