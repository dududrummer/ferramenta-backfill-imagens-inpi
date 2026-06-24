// Modo DESPACHOS: re-raspa o DETALHE de cada n_url da faixa (em vez da imagem), parseia com o parser
// do worker (extrai complemento certo) e grava nas tabelas de staging *_rerasp via SSH. Reaproveita
// o Tor pool / sessão pePI / rotação / retomada da ferramenta de imagens.
const { warmSession } = require('./http-session');
const { buscarDetalhe } = require('./detalhe');
const { parseDetailFull } = require('./parser-html');
const { criarPoolBackend } = require('./pool');
const { criarStager } = require('./ch-stage');
const { talvezRotacionar, horaAgora, registrarEvento } = require('./runner');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Processa um n_url: busca detalhe, parseia, empilha no stager. Atualiza o catálogo (retomada).
async function processarDespacho(nUrl, circ, ctx) {
  const { cfg, pool, stager, catalogo } = ctx;
  let tent = 0, motivo = '?', ultErro = '';
  while (tent < cfg.maxTentativas) {
    tent++;
    if (!circ.warm) {
      try { await warmSession(circ, cfg.timeoutMs); } catch (e) { circ.warm = false; ultErro = e.message; }
      if (!circ.warm) { motivo = 'warm_falhou'; await pool.newnym(circ); await sleep(1000 * tent); continue; }
    }
    const r = await buscarDetalhe(circ, nUrl, cfg.timeoutMs);
    motivo = r.resultado; if (r.erro) ultErro = r.erro;
    if (r.resultado === 'ok') {
      let parsed;
      try { parsed = parseDetailFull(r.html, nUrl); }
      catch (e) { catalogo.marcar(nUrl, 'falhou', { tentativas: tent, erro: 'parse: ' + e.message }); return 'falhou'; }
      stager.add(parsed);
      catalogo.marcar(nUrl, 'gravado', { tentativas: tent });
      registrarEvento(cfg, `${horaAgora()} GRAVADO    n_url=${nUrl} despachos=${(parsed.marcas_despachos || []).length}`);
      await talvezRotacionar(circ, pool, cfg);
      return 'gravado';
    }
    if (r.resultado === 'inexistente' || r.resultado === 'sem_dados') {
      catalogo.marcar(nUrl, 'sem_dados', { tentativas: tent });
      await talvezRotacionar(circ, pool, cfg);
      return 'sem_dados';
    }
    if (r.resultado === 'sessao')   { circ.warm = false; continue; }                                  // re-aquece e retenta
    if (r.resultado === 'bloqueio') { await pool.newnym(circ); circ._reqCount = 0; circ.warm = false; await sleep(1000 * tent); continue; }
    await sleep(1000 * tent);   // erro transitório
  }
  catalogo.marcar(nUrl, 'falhou', { tentativas: tent, erro: `${motivo}${ultErro ? ': ' + ultErro : ''}` });
  registrarEvento(cfg, `${horaAgora()} FALHOU     n_url=${nUrl} (motivo=${motivo}${ultErro ? ' | ' + ultErro : ''})`);
  return 'falhou';
}

// Flush coalescido (1 por vez) — evita inserts SSH concorrentes da mesma máquina.
let _flushing = null;
function flushStager(stager) {
  if (_flushing) return _flushing;
  _flushing = (async () => { try { await stager.flush(); } finally { _flushing = null; } })();
  return _flushing;
}

async function comandoRunDespachos(cfg, catalogo, opts) {
  const concurrency = opts.concurrency || cfg.concurrency;
  const pool = criarPoolBackend(cfg);
  const stager = criarStager(cfg);
  const FLOOR = 4145;
  let min = FLOOR, max = null;
  if (opts.range) {
    const [a, b] = opts.range.split('-').map(Number);
    if (!Number.isNaN(a)) min = Math.max(FLOOR, a);
    if (!Number.isNaN(b)) max = b;
  }
  if (max == null) throw new Error('run-despachos exige --range INICIO-FIM (com fim).');

  console.log(`Re-raspagem de DESPACHOS — faixa ${min}-${max}, concorrência ${concurrency}. Grava nas *_rerasp via SSH.`);
  console.log('Catálogo (retomada):', cfg.catalogPath, '| flush a cada', cfg.rsyncBatch, 'gravadas.');
  const ctx = { cfg, pool, stager, catalogo };
  let atual = min, tentadas = 0, gravadas = 0, semDados = 0;

  function proximo() {
    while (atual <= max) {
      const n = atual++;
      const s = catalogo.obterStatus(n);
      if (s && (s.status === 'gravado' || s.status === 'sem_dados')) continue;   // já feito → pula (retomada)
      return n;
    }
    return null;
  }
  const FLUSH = cfg.rsyncBatch || 500;

  async function worker() {
    let n;
    while ((n = proximo()) !== null) {
      const circ = pool.proximoCircuito();
      const r = await processarDespacho(n, circ, ctx);
      tentadas++;
      if (r === 'gravado') gravadas++;
      else if (r === 'sem_dados') semDados++;
      if (stager.pendentes() >= FLUSH) await flushStager(stager);
      if (tentadas % 500 === 0) console.log(`...${tentadas} tentadas, ${gravadas} gravadas, ${semDados} sem dados (n_url~${n})`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await flushStager(stager);
  console.log('Despachos concluídos.', catalogo.estatisticas());
}

module.exports = { processarDespacho, comandoRunDespachos, flushStager };
