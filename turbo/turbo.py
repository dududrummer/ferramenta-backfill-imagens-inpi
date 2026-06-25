#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
turbo.py — re-raspagem da PÁGINA COMPLETA do INPI por Tor, rápida e retomável.

Roda em WSL / Colab / servidor. Recebe a faixa por argumento. Sobe o Tor sozinho (torrc otimizado),
usa N circuitos isolados por porta (IsolateSOCKSAuth) e, a cada 2000 páginas 'ok', chama o helper
Node (parse_insert.js) que parseia com o MESMO parseDetailFull e grava em *_rerasp via ch-stage.
Assim a saída no banco é idêntica à da carga manual — o Python só faz o fetch/orquestração.

Uso:
  python3 turbo/turbo.py --range 4145-100000 [--ports 3] [--circuits-per-port 20]
      [--base-port 9050] [--flush 2000] [--max-tentativas 3] [--catalog PATH]
      [--tor-data DIR] [--conc N] [--no-tor]

Pré: tor instalado (a menos de --no-tor), node + deps da ferramenta (para o parse_insert.js),
     .env da ferramenta na raiz (SSH/CH), e `pip install requests PySocks`.
"""
import argparse
import json
import os
import queue
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import time

try:
    import requests
except ImportError:
    requests = None   # só é necessário para o fetch; a lógica/Catálogo importam sem ele

# --- constantes do INPI (espelham http-session.js / detalhe.js) ---
BASE = "https://busca.inpi.gov.br/pePI"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
WARMUP_PROC = "821010000"
HDRS = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate"}

# raiz da ferramenta (pai de turbo/) — onde está o .env e o src/ usado pelo helper Node
FERRA_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "parse_insert.js")


# ----------------------------------------------------------------------------
# Lógica determinística (testável sem rede)
# ----------------------------------------------------------------------------
def parse_range(s):
    """'4145-100000' -> (4145, 100000). Valida e exige fim."""
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", str(s or ""))
    if not m:
        raise ValueError("range inválido; use --range INICIO-FIM (ex.: 4145-100000)")
    a, b = int(m.group(1)), int(m.group(2))
    a = max(4145, a)  # FLOOR igual à aplicação
    if b < a:
        raise ValueError("fim do range menor que o início")
    return a, b


def classificar(status, html):
    """Espelha detalhe.js + isSessionExpired. Retorna ok/sessao/bloqueio/inexistente/sem_dados."""
    if status == 302 or re.search(r'name="T_Login"', html or "", re.I):
        return "sessao"
    if re.search(r"inacess|java\.sql|systables", html or "", re.I) and "accordion-item" not in html:
        return "bloqueio"
    if "Erro: Pedido inexistente!" in html:
        return "inexistente"
    if "accordion-item" not in html:
        return "sem_dados"
    return "ok"


# ----------------------------------------------------------------------------
# Catálogo (sqlite, mesma tabela 'status' do catalog.js — retomável)
# ----------------------------------------------------------------------------
class Catalog:
    def __init__(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS status ("
            "n_url INTEGER PRIMARY KEY, status TEXT NOT NULL, "
            "tentativas INTEGER DEFAULT 0, erro TEXT, ts INTEGER)")
        self.conn.commit()
        self.lock = threading.Lock()

    def done_set(self):
        """n_urls já finalizadas (gravado/sem_dados) — para retomada."""
        cur = self.conn.execute("SELECT n_url FROM status WHERE status IN ('gravado','sem_dados')")
        return set(r[0] for r in cur)

    def mark(self, n, status, tentativas=0, erro=None):
        with self.lock:
            self.conn.execute(
                "INSERT INTO status(n_url,status,tentativas,erro,ts) VALUES(?,?,?,?,?) "
                "ON CONFLICT(n_url) DO UPDATE SET status=excluded.status,"
                "tentativas=excluded.tentativas,erro=excluded.erro,ts=excluded.ts",
                (n, status, tentativas, erro, int(time.time())))
            self.conn.commit()

    def mark_many(self, ns, status):
        if not ns:
            return
        with self.lock:
            self.conn.executemany(
                "INSERT INTO status(n_url,status,ts) VALUES(?,?,?) "
                "ON CONFLICT(n_url) DO UPDATE SET status=excluded.status,ts=excluded.ts",
                [(n, status, int(time.time())) for n in ns])
            self.conn.commit()

    def stats(self):
        cur = self.conn.execute("SELECT status,COUNT(*) FROM status GROUP BY status")
        return dict(cur.fetchall())


# ----------------------------------------------------------------------------
# Circuito = uma sessão requests com usuário SOCKS próprio (1 circuito Tor isolado)
# ----------------------------------------------------------------------------
class Circuit:
    def __init__(self, host, port, idx):
        self.host, self.port, self.idx = host, port, idx
        self.gen = 0
        self.warm = False
        self.last_err = ""
        self._novo()

    def _novo(self):
        # usuário SOCKS único por circuito (e por geração) => IsolateSOCKSAuth dá circuito novo
        user = "c%d_%d_%d" % (self.port, self.idx, self.gen)
        proxy = "socks5h://%s:x@%s:%d" % (user, self.host, self.port)
        s = requests.Session()
        s.proxies = {"http": proxy, "https": proxy}
        s.headers.update(HDRS)
        self.session = s

    def rotate(self):
        """Novo IP/circuito de saída: novo usuário SOCKS + jar limpo (sessão pePI tem que refazer)."""
        self.gen += 1
        self.warm = False
        try:
            self.session.close()
        except Exception:
            pass
        self._novo()


def warm(circ, timeout):
    """Aquece a sessão pePI (4 reqs), espelhando warmSession do http-session.js."""
    s = circ.session
    try:
        s.get(BASE + "/", timeout=timeout, allow_redirects=False)
        s.post(BASE + "/servlet/LoginController",
               data="T_Login=&T_Senha=&action=login&Usuario=",
               headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": BASE + "/"},
               timeout=timeout, allow_redirects=False)
        s.get(BASE + "/jsp/marcas/Pesquisa_num_processo.jsp", timeout=timeout, allow_redirects=False)
        r = s.post(BASE + "/servlet/MarcasServletController",
                   data=("Action=searchMarca&tipoPesquisa=BY_NUM_PROC&NumPedido=%s"
                         "&NumGRU=&NumProtocolo=&NumInscricaoInternacional=" % WARMUP_PROC),
                   headers={"Content-Type": "application/x-www-form-urlencoded",
                            "Referer": BASE + "/jsp/marcas/Pesquisa_num_processo.jsp"},
                   timeout=timeout, allow_redirects=False)
        html = r.content.decode("latin1")
        circ.warm = not (r.status_code == 302 or re.search(r'name="T_Login"', html, re.I))
    except Exception as e:
        circ.warm = False
        circ.last_err = str(e)
    return circ.warm


def buscar_detalhe(circ, n, timeout):
    """GET do detalhe (CodPedido). Retorna (status, html_latin1, erro)."""
    try:
        r = circ.session.get(
            BASE + "/servlet/MarcasServletController?Action=detail&CodPedido=%d" % n,
            timeout=timeout, allow_redirects=False)
        return r.status_code, r.content.decode("latin1"), None
    except Exception as e:
        return 0, "", str(e)


def processar(n, circ, max_tent, timeout):
    """Processa um n_url com retry/rotação. Retorna (status_final, html_ou_None, tentativas, motivo)."""
    nodata = False
    motivo = "?"
    for tent in range(1, max_tent + 1):
        if not circ.warm:
            if not warm(circ, timeout):
                motivo = "warm_falhou: " + (circ.last_err or "")
                circ.rotate(); time.sleep(min(tent, 5)); continue
        status, html, err = buscar_detalhe(circ, n, timeout)
        if err:
            motivo = "erro: " + err
            circ.warm = False; time.sleep(min(tent, 5)); continue
        r = classificar(status, html)
        if r == "ok":
            return "ok", html, tent, "ok"
        if r == "inexistente":
            return "sem_dados", None, tent, "inexistente"            # definitivo, não re-tenta
        motivo = r
        if r == "sessao":
            circ.warm = False; continue                             # re-aquece e re-tenta
        if r == "bloqueio":
            circ.rotate(); time.sleep(min(tent, 5)); continue
        # sem_dados: pode ser transitório -> rotaciona e re-tenta (combinado com o usuário)
        nodata = True
        circ.rotate(); time.sleep(min(tent, 5))
    return ("sem_dados" if nodata else "falhou"), None, max_tent, motivo


# ----------------------------------------------------------------------------
# Tor (sobe sozinho, torrc otimizado)
# ----------------------------------------------------------------------------
TORRC = """SocksPort {port} IsolateSOCKSAuth
DataDirectory {data}
CookieAuthentication 0
UseEntryGuards 0
LearnCircuitBuildTimeout 0
CircuitBuildTimeout 10
CircuitStreamTimeout 10
ConnectionPadding 0
ClientOnly 1
AvoidDiskWrites 1
MaxCircuitDirtiness 600
Log notice file {data}/notice.log
"""


def subir_tor(ports, data_base, log):
    os.makedirs(data_base, exist_ok=True)
    try:
        os.chmod(data_base, 0o700)
    except Exception:
        pass
    procs = []
    for p in ports:
        d = os.path.join(data_base, "tor%d" % p)
        os.makedirs(d, exist_ok=True)
        try:
            os.chmod(d, 0o700)
        except Exception:
            pass
        conf = os.path.join(data_base, "torrc-%d" % p)
        with open(conf, "w") as f:
            f.write(TORRC.format(port=p, data=d))
        logf = open(os.path.join(data_base, "tor%d.out" % p), "wb")
        proc = subprocess.Popen(["tor", "-f", conf], stdout=logf, stderr=subprocess.STDOUT)
        procs.append((p, proc, os.path.join(d, "notice.log")))
        log("Tor subindo na porta %d (pid %d)" % (p, proc.pid))
        time.sleep(1)
    # espera bootstrap (até ~180s; a 1ª execução baixa o consenso e é mais lenta)
    log("Aguardando bootstrap do Tor...")
    prazo = time.time() + 180
    prontos = set()
    while time.time() < prazo and len(prontos) < len(procs):
        for p, _proc, notice in procs:
            if p in prontos:
                continue
            try:
                with open(notice, "r", errors="ignore") as f:
                    if "Bootstrapped 100" in f.read():
                        prontos.add(p)
            except Exception:
                pass
        time.sleep(2)
    log("Tor pronto: %d/%d portas com Bootstrapped 100%%" % (len(prontos), len(procs)))
    return procs, prontos


def parar_tor(procs, log):
    for p, proc, _ in procs:
        try:
            proc.terminate()
        except Exception:
            pass
    log("Tor encerrado (%d instâncias)." % len(procs))


# ----------------------------------------------------------------------------
# Gravação em lote via helper Node (parse + insert idênticos ao sistema)
# ----------------------------------------------------------------------------
def chamar_node(batch_dir, log, tries=3):
    """Roda o parse_insert.js sobre o lote. Retorna {'ok':[...],'fail':[...]} ou None se falhou."""
    for t in range(1, tries + 1):
        p = subprocess.run(["node", NODE_HELPER, batch_dir], cwd=FERRA_ROOT,
                           capture_output=True, text=True)
        if p.returncode == 0:
            try:
                return json.loads(p.stdout.strip().splitlines()[-1])
            except Exception:
                return {"ok": [], "fail": []}
        log("node insert falhou (tent %d): %s" % (t, (p.stderr or "").strip()[:200]))
        time.sleep(2 * t)
    return None


# ----------------------------------------------------------------------------
# Orquestração: feeder -> workers -> writer
# ----------------------------------------------------------------------------
def rodar(args, log):
    if requests is None:
        raise SystemExit("Faltam dependências: pip install requests PySocks")
    a, b = parse_range(args.range)
    catalog = Catalog(args.catalog)
    feitos = catalog.done_set()
    log("Faixa %d-%d | já feitos: %d | flush %d | retries %d" %
        (a, b, len(feitos), args.flush, args.max_tentativas))

    ports = [args.base_port + i for i in range(args.ports)]
    circuits = [Circuit("127.0.0.1", p, i) for p in ports for i in range(args.circuits_per_port)]
    conc = args.conc or len(circuits)
    if conc > len(circuits):
        conc = len(circuits)
    log("Portas Tor: %s | %d circuitos/porta | %d workers" %
        (ports, args.circuits_per_port, conc))

    tor_procs = []
    if not args.no_tor:
        tor_procs, prontos = subir_tor(ports, args.tor_data, log)
        if not prontos:
            parar_tor(tor_procs, log)
            raise SystemExit(
                "Nenhuma instância Tor bootstrapou — abortando (a faixa NÃO foi tocada).\n"
                "Causas comuns:\n"
                "  - porta ocupada (tor do sistema na 9050): `sudo systemctl stop tor` "
                "OU use --base-port 9060;\n"
                "  - 1ª execução lenta: rode de novo (o consenso fica em cache em ~/.turbo-tor);\n"
                "  - sem saída pra rede do Tor: veja ~/.turbo-tor/tor<porta>/notice.log.")

    work_q = queue.Queue(maxsize=conc * 4)
    result_q = queue.Queue(maxsize=conc * 4)
    contadores = {"gravado": 0, "sem_dados": 0, "falhou": 0}
    parar = threading.Event()

    def feeder():
        for n in range(a, b + 1):
            if parar.is_set():
                break
            if n in feitos:
                continue
            work_q.put(n)
        for _ in range(conc):
            work_q.put(None)   # sentinela por worker

    def worker(i):
        circ = circuits[i]
        while not parar.is_set():
            n = work_q.get()
            if n is None:
                break
            st, html, tent, motivo = processar(n, circ, args.max_tentativas, args.timeout)
            result_q.put((n, st, html, tent, motivo))

    def writer():
        batch_idx = 0
        batch_dir = os.path.join(args.tmp, "batch_%d" % batch_idx)
        os.makedirs(batch_dir, exist_ok=True)
        pend = []

        def flush():
            nonlocal batch_idx, batch_dir, pend
            if not pend:
                return
            res = chamar_node(os.path.abspath(batch_dir), log)
            if res is None:
                log("FLUSH falhou; %d páginas ficam pendentes (retoma num próximo passe)" % len(pend))
            else:
                catalog.mark_many(res.get("ok", []), "gravado")
                catalog.mark_many(res.get("fail", []), "falhou")
                contadores["gravado"] += len(res.get("ok", []))
                contadores["falhou"] += len(res.get("fail", []))
            shutil.rmtree(batch_dir, ignore_errors=True)
            batch_idx += 1
            batch_dir = os.path.join(args.tmp, "batch_%d" % batch_idx)
            os.makedirs(batch_dir, exist_ok=True)
            pend = []

        motivos = {}
        amostra = 0
        processados = 0
        while True:
            item = result_q.get()
            if item is None:
                break
            n, st, html, tent, motivo = item
            if st == "ok":
                with open(os.path.join(batch_dir, "%d.html" % n), "w", encoding="latin1") as f:
                    f.write(html)
                pend.append(n)
                if len(pend) >= args.flush:
                    flush()
            else:
                k = motivo.split(":")[0]
                motivos[k] = motivos.get(k, 0) + 1
                if st == "sem_dados":
                    catalog.mark(n, "sem_dados", tent)
                    contadores["sem_dados"] += 1
                else:
                    catalog.mark(n, "falhou", tent, motivo[:200])
                    contadores["falhou"] += 1
                    if amostra < 10:                      # mostra os 1ºs motivos p/ diagnóstico
                        log("FALHOU n=%d motivo=%s" % (n, motivo[:160]))
                        amostra += 1
            processados += 1
            if processados % 1000 == 0:
                log("...%d processados | gravado=%d sem_dados=%d falhou=%d | motivos=%s (n~%d)" %
                    (processados, contadores["gravado"], contadores["sem_dados"],
                     contadores["falhou"], motivos, n))
        flush()  # resto
        if motivos:
            log("motivos (não-ok): %s" % motivos)

    os.makedirs(args.tmp, exist_ok=True)
    th_feeder = threading.Thread(target=feeder, name="feeder")
    th_writer = threading.Thread(target=writer, name="writer")
    th_workers = [threading.Thread(target=worker, args=(i,), name="w%d" % i) for i in range(conc)]

    def encerrar(signum=None, frame=None):
        log("Interrompido — finalizando com segurança...")
        parar.set()
    signal.signal(signal.SIGINT, encerrar)
    try:
        signal.signal(signal.SIGTERM, encerrar)
    except Exception:
        pass

    th_writer.start()
    for t in th_workers:
        t.start()
    th_feeder.start()

    th_feeder.join()
    for t in th_workers:
        t.join()
    result_q.put(None)   # encerra o writer
    th_writer.join()

    if tor_procs:
        parar_tor(tor_procs, log)
    log("Concluído. Catálogo: %s" % catalog.stats())


def main(argv=None):
    ap = argparse.ArgumentParser(description="Re-raspagem da página completa do INPI por Tor (turbo).")
    ap.add_argument("--range", required=True, help="faixa de n_url, ex.: 4145-100000")
    ap.add_argument("--ports", type=int, default=3, help="nº de instâncias Tor (default 3)")
    ap.add_argument("--circuits-per-port", type=int, default=20, dest="circuits_per_port",
                    help="circuitos isolados por porta (default 20)")
    ap.add_argument("--base-port", type=int, default=9050, dest="base_port")
    ap.add_argument("--conc", type=int, default=0, help="workers (default = portas*circuitos)")
    ap.add_argument("--flush", type=int, default=2000, help="grava no banco a cada N 'ok' (default 2000)")
    ap.add_argument("--max-tentativas", type=int, default=3, dest="max_tentativas")
    ap.add_argument("--timeout", type=float, default=30.0, help="timeout HTTP em s (default 30)")
    ap.add_argument("--catalog", default=None, help="sqlite de retomada (default catalogos/turbo_<a>_<b>.sqlite)")
    ap.add_argument("--tor-data", default=os.path.expanduser("~/.turbo-tor"), dest="tor_data")
    ap.add_argument("--tmp", default=None, help="dir temporário dos lotes (default tmp_turbo/)")
    ap.add_argument("--no-tor", action="store_true", dest="no_tor", help="não sobe o Tor (já está rodando)")
    args = ap.parse_args(argv)

    a, b = parse_range(args.range)
    if not args.catalog:
        args.catalog = os.path.join("catalogos", "turbo_%d_%d.sqlite" % (a, b))
    if not args.tmp:
        args.tmp = os.path.join("tmp_turbo", "%d_%d" % (a, b))

    def log(msg):
        print("%s %s" % (time.strftime("%H:%M:%S"), msg), flush=True)

    rodar(args, log)


if __name__ == "__main__":
    main()
