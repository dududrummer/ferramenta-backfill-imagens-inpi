# turbo — re-raspagem da página completa do INPI por Tor (Python)

Roda em **WSL / Colab / servidor**, recebe a **faixa por argumento**, raspa a página completa de
detalhe pelo Tor (rápido) e grava nas tabelas de **staging `*_rerasp`** com **paridade total** com a
carga manual — porque o parse + insert reusam o `parseDetailFull` e o `ch-stage` do sistema (via o
helper Node `parse_insert.js`). O Python só faz fetch/orquestração. **Sem imagens.**

## Como funciona
- Sobe o Tor sozinho (torrc otimizado), 1 instância por porta, **20 circuitos isolados por porta**
  (usuário SOCKS distinto por worker → `IsolateSOCKSAuth`).
- `feeder` → `workers` (1 por circuito, fetch+retry) → `writer` (lotes de 2000 → helper Node → `*_rerasp`).
- Retry 3x (erro/sem_dados/sessao/bloqueio) com rotação de circuito; `inexistente` é terminal.
- `falhou` não é buraco: o `feeder` só pula `gravado`/`sem_dados`, então um próximo passe o retoma.
- Catálogo sqlite retomável (`catalogos/turbo_<a>_<b>.sqlite`).

## Pré-requisitos
```bash
# Tor
sudo apt-get install -y tor          # (ou: tem que ter o binário `tor` no PATH)
# Python — requests + PySocks
#   Debian/Ubuntu 24.04+ (PEP 668 bloqueia pip system-wide): use o apt
sudo apt install -y python3-requests python3-socks
#   Colab / venv: pip funciona normalmente
#   pip install -r turbo/requirements.txt
# Node + deps da ferramenta (para o parse_insert.js) e o .env (SSH/CH) na RAIZ da ferramenta
npm install
cp .env.tor.example .env             # ajuste SSH_HOST/SSH_USER/SSH_KEY/CH_DATABASE
```
> O helper Node usa o mesmo `.env` da ferramenta (SSH + ClickHouse). Rode o `turbo.py` a partir da
> **raiz da ferramenta** para o `.env` ser encontrado.

## Uso
```bash
# faixa por argumento; sobe o Tor sozinho
python3 turbo/turbo.py --range 4145-100000

# em várias máquinas, cada uma uma faixa:
python3 turbo/turbo.py --range 100001-200000
python3 turbo/turbo.py --range 200001-300000

# opções
python3 turbo/turbo.py --range 4145-100000 \
  --ports 3 --circuits-per-port 20 --base-port 9050 \
  --flush 2000 --max-tentativas 3 \
  --catalog catalogos/turbo_a.sqlite

# se o Tor já estiver rodando (não subir aqui):
python3 turbo/turbo.py --range 4145-100000 --no-tor --base-port 9050 --ports 3
```

## Rodar em background (sobrevive a desconexão)
```bash
mkdir -p logs
nohup python3 turbo/turbo.py --range 4145-100000 > logs/turbo.out 2>&1 &
tail -f logs/turbo.out
```

## Acompanhar / retomar
- Progresso vai no stdout (`...N processados | gravado=.. sem_dados=.. falhou=..`).
- Reiniciar continua de onde parou (pula `gravado`/`sem_dados` pelo catálogo).
- Para forçar reraspagem do zero de uma faixa: apague o catálogo dela.

## Merge (depois)
Continua o mesmo do sistema: quando as faixas terminarem, `node worker/scripts/rerasp-merge.js`
no droplet faz o swap `*_rerasp` → vivas.

## Testes
```bash
cd turbo && python -m unittest -v
```
