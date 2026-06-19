#!/usr/bin/env node
const fs = require('fs');
const { execFileSync } = require('child_process');
const { carregarConfig } = require('./config');
const { abrirCatalogo } = require('./catalog');
const { criarPool } = require('./tor-pool');
const { criarClient, criarFonte } = require('./candidates');
const { sincronizar } = require('./uploader');
const { filtrarPendentes, processarUm } = require('./runner');
const { nUrlDeCaminho, caminhoImagem } = require('./sharding');

function parseArgs(argv) {
  const cmd = argv[2];
  const opts = {};
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--phase') opts.phase = Number(argv[++i]);
    else if (a === '--range') opts.range = argv[++i];
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (a === '--keep-local') opts.keepLocal = true;
  }
  return { cmd, opts };
}

// Constrói o índice do que já existe no servidor via SSH find.
function comandoIndex(cfg, catalogo) {
  const sshArgs = [];
  if (cfg.ssh.key) sshArgs.push('-i', cfg.ssh.key);
  if (cfg.ssh.port) sshArgs.push('-p', String(cfg.ssh.port));
  sshArgs.push(`${cfg.ssh.user}@${cfg.ssh.host}`,
    `find ${cfg.remoteImageDir} -type f -name '*.*'`);
  const out = execFileSync('ssh', sshArgs, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });
  const nUrls = out.split('\n').map(nUrlDeCaminho).filter(n => n != null);
  catalogo.inserirExistentes(nUrls);
  console.log(`Indexados ${nUrls.length} arquivos já existentes no servidor.`);
}

async function comandoRun(cfg, catalogo, opts) {
  const concurrency = opts.concurrency || cfg.concurrency;
  const client = criarClient(cfg.ch);
  const fonte = criarFonte({ client, database: cfg.ch.database });
  const pool = criarPool(cfg);

  let candidatos, eraTemImagem;
  if (opts.phase === 2) {
    let min, max;
    if (opts.range) { [min, max] = opts.range.split('-').map(Number); }
    candidatos = await fonte.candidatosFase2(min, max);
    eraTemImagem = false;
  } else {
    candidatos = await fonte.candidatosFase1();
    eraTemImagem = true;
  }
  const pendentes = filtrarPendentes(candidatos, catalogo);
  console.log(`Fase ${opts.phase || 1}: ${pendentes.length} a baixar (de ${candidatos.length} candidatos).`);

  const ctx = { catalogo, pool, cfg, eraTemImagem };
  let i = 0, baixadas = 0;
  async function worker() {
    while (i < pendentes.length) {
      const nUrl = pendentes[i++];
      const circ = pool.proximoCircuito();
      const r = await processarUm(nUrl, circ, ctx);
      if (r === 'baixada') baixadas++;
      if (baixadas > 0 && baixadas % cfg.rsyncBatch === 0) await flush(cfg, catalogo, fonte, opts);
      if ((i % 500) === 0) console.log(`...${i}/${pendentes.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await flush(cfg, catalogo, fonte, opts);
  await client.close();
  console.log('Concluído.', catalogo.estatisticas());
}

let _flushEmAndamento = null;
async function flush(cfg, catalogo, fonte, opts = {}) {
  // Coalesce: se já há um flush rodando, aguarda o mesmo (evita rsync/delete concorrentes).
  if (_flushEmAndamento) return _flushEmAndamento;
  const sincronizarFn = opts._sincronizar || sincronizar;
  _flushEmAndamento = (async () => {
    const paraUpload = catalogo.pendentesParaUpload();   // [{ n_url, ext }]
    if (paraUpload.length > 0) {
      await sincronizarFn(cfg);
      catalogo.confirmarUpload(paraUpload.map(r => r.n_url));
      if (!opts.keepLocal) {
        // Apaga só os arquivos confirmados deste snapshot; escritas concorrentes de
        // outros workers (n_url fora do snapshot) são preservadas para o próximo flush.
        for (const r of paraUpload) {
          try { fs.rmSync(caminhoImagem(r.n_url, cfg.localStaging, r.ext), { force: true }); } catch (_) {}
        }
      }
    }
    const paraMarcar = catalogo.pendentesParaMarcarDb();
    if (paraMarcar.length > 0) {
      await fonte.marcarTemImagem(paraMarcar, cfg.chUpdateBatch);
      catalogo.confirmarMarcacaoDb(paraMarcar);
    }
  })();
  try { await _flushEmAndamento; } finally { _flushEmAndamento = null; }
}

async function main() {
  const cfg = carregarConfig();
  const catalogo = abrirCatalogo(cfg.catalogPath);
  const { cmd, opts } = parseArgs(process.argv);
  try {
    if (cmd === 'index') comandoIndex(cfg, catalogo);
    else if (cmd === 'run') await comandoRun(cfg, catalogo, opts);
    else if (cmd === 'status') console.log(catalogo.estatisticas());
    else if (cmd === 'flush') {
      const client = criarClient(cfg.ch);
      const fonte = criarFonte({ client, database: cfg.ch.database });
      await flush(cfg, catalogo, fonte, opts);
      await client.close();
    } else {
      console.log('Comandos: index | run --phase <1|2> [--range A-B] [--concurrency N] [--keep-local] | status | flush');
    }
  } finally {
    catalogo.fechar();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { parseArgs, flush };
