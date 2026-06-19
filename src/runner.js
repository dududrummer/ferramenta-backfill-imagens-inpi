const fs = require('fs');
const { caminhoImagem, dirImagem } = require('./sharding');
const { baixarBuffer, classificarResultado } = require('./downloader');

function filtrarPendentes(nUrls, catalogo) {
  return nUrls.filter(n => !catalogo.jaProcessado(n));
}

function salvarImagem(nUrl, buffer, ext, baseDir) {
  fs.mkdirSync(dirImagem(nUrl, baseDir), { recursive: true });
  const dest = caminhoImagem(nUrl, baseDir, ext);
  fs.writeFileSync(dest, buffer);
  return dest;
}

// Processa um único n_url usando um circuito; atualiza o catálogo. Retorna o resultado.
async function processarUm(nUrl, circuito, ctx) {
  const { catalogo, pool, cfg, eraTemImagem } = ctx;
  const intervaloMs = cfg.ratePerCircuit > 0 ? 1000 / cfg.ratePerCircuit : 0;
  let tentativas = 0;
  while (tentativas < cfg.maxTentativas) {
    tentativas++;
    if (intervaloMs > 0) {
      // Espaça as requisições por circuito (rate-limit educado por IP de saída).
      const espera = (circuito._proximaLiberacao || 0) - Date.now();
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
      circuito._proximaLiberacao = Date.now() + intervaloMs;
    }
    const res = await baixarBuffer(circuito, nUrl, { timeoutMs: cfg.timeoutMs });
    const cls = classificarResultado(res, cfg.placeholderHashes);
    if (cls.resultado === 'baixada') {
      salvarImagem(nUrl, cls.buffer, cls.ext, cfg.localStaging);
      catalogo.marcar(nUrl, 'baixada', {
        ext: cls.ext, uploaded: 0, marcar_db: eraTemImagem ? 0 : 1, tentativas,
      });
      return 'baixada';
    }
    if (cls.resultado === 'sem_imagem') {
      catalogo.marcar(nUrl, 'sem_imagem', { tentativas });
      return 'sem_imagem';
    }
    if (cls.resultado === 'bloqueio') {
      await pool.newnym(circuito);
      await new Promise(r => setTimeout(r, 1000 * tentativas));   // backoff
      continue;
    }
    // erro transitório: backoff e tenta de novo
    await new Promise(r => setTimeout(r, 1000 * tentativas));
  }
  catalogo.marcar(nUrl, 'falhou', { tentativas, erro: 'maxTentativas' });
  return 'falhou';
}

module.exports = { filtrarPendentes, salvarImagem, processarUm };
