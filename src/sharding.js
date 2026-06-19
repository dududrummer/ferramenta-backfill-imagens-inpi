const path = require('path');

function dirImagem(nUrl, baseDir) {
  const nivel1 = Math.floor(nUrl / 1_000_000);
  const nivel2 = Math.floor(nUrl / 1_000) % 1_000;
  return path.join(baseDir, String(nivel1), String(nivel2));
}

function caminhoImagem(nUrl, baseDir, ext) {
  return path.join(dirImagem(nUrl, baseDir), `${nUrl}.${ext}`);
}

function nUrlDeCaminho(p) {
  const base = path.basename(p);
  const m = base.match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

module.exports = { dirImagem, caminhoImagem, nUrlDeCaminho };
