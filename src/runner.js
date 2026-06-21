const fs = require('fs');
const { caminhoImagem, dirImagem } = require('./sharding');
const { baixarBuffer, classificarResultado } = require('./downloader');
const { warmSession } = require('./http-session');

function horaAgora() {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS (UTC)
}

function registrarEvento(cfg, texto) {
  if (!cfg || !cfg.eventsLog) return;
  try { fs.appendFileSync(cfg.eventsLog, texto + '\n'); } catch (_) { /* log é best-effort */ }
}

function filtrarPendentes(candidatos, catalogo) {
  return candidatos.filter(c => !catalogo.jaProcessado(c.n_url));
}

function salvarImagem(nUrl, buffer, ext, baseDir) {
  fs.mkdirSync(dirImagem(nUrl, baseDir), { recursive: true });
  const dest = caminhoImagem(nUrl, baseDir, ext);
  fs.writeFileSync(dest, buffer);
  return dest;
}

// Processa uma candidata {n_url, temImagem} usando um circuito; atualiza o catálogo.
async function processarUm(candidato, circuito, ctx) {
  const { catalogo, pool, cfg } = ctx;
  const nUrl = candidato.n_url;
  const intervaloMs = cfg.ratePerCircuit > 0 ? 1000 / cfg.ratePerCircuit : 0;
  let tentativas = 0;
  while (tentativas < cfg.maxTentativas) {
    tentativas++;
    if (intervaloMs > 0) {
      const espera = (circuito._proximaLiberacao || 0) - Date.now();
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
      circuito._proximaLiberacao = Date.now() + intervaloMs;
    }
    // Garante a sessão pePI (cookies) aquecida antes de baixar.
    if (!circuito.warm) {
      try { await warmSession(circuito, cfg.timeoutMs); } catch (_) { circuito.warm = false; }
      if (!circuito.warm) { await pool.newnym(circuito); await new Promise(r => setTimeout(r, 1000 * tentativas)); continue; }
    }
    const res = await baixarBuffer(circuito, nUrl, { timeoutMs: cfg.timeoutMs });
    const cls = classificarResultado(res, cfg.placeholderHashes);
    if (cls.resultado === 'baixada') {
      salvarImagem(nUrl, cls.buffer, cls.ext, cfg.localStaging);
      catalogo.marcar(nUrl, 'baixada', {
        ext: cls.ext, uploaded: 0, marcar_db: candidato.temImagem ? 0 : 1, tentativas,
      });
      registrarEvento(cfg, `${horaAgora()} BAIXADA    n_url=${nUrl} ext=${cls.ext}`);
      return 'baixada';
    }
    if (cls.resultado === 'sem_imagem') {
      catalogo.marcar(nUrl, 'sem_imagem', { tentativas });
      registrarEvento(cfg, `${horaAgora()} SEM_IMAGEM n_url=${nUrl}`);
      return 'sem_imagem';
    }
    if (cls.resultado === 'sessao') {
      circuito.warm = false;          // re-aquece a sessão na próxima volta e re-tenta
      continue;
    }
    if (cls.resultado === 'bloqueio') {
      await pool.newnym(circuito);
      circuito.warm = false;          // IP de saída mudou → sessão precisa ser refeita
      await new Promise(r => setTimeout(r, 1000 * tentativas));
      continue;
    }
    await new Promise(r => setTimeout(r, 1000 * tentativas));   // erro transitório
  }
  catalogo.marcar(nUrl, 'falhou', { tentativas, erro: 'maxTentativas' });
  registrarEvento(cfg, `${horaAgora()} FALHOU     n_url=${nUrl}`);
  return 'falhou';
}

module.exports = { filtrarPendentes, salvarImagem, processarUm, registrarEvento, horaAgora };
