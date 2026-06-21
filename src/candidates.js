const { montarSshArgs } = require('./exec');

function construtorQueries(database) {
  const T = `${database}.marcas`;
  return {
    // n_urls que a tabela marca como puramente nominativa (não têm logo) — usados para PULAR.
    nominativas(min, max) {
      let w = "apresentacao = 'Nominativa'";
      if (min != null && max != null) w += ` AND n_url >= ${min} AND n_url <= ${max}`;
      return `SELECT n_url FROM ${T} WHERE ${w}`;
    },
    maxNUrl() {
      return `SELECT max(n_url) FROM ${T}`;
    },
    updateTemImagem(nUrls) {
      return `ALTER TABLE ${T} UPDATE tem_imagem=1 WHERE n_url IN (${nUrls.join(',')})`;
    },
  };
}

// executor: função (comando)->Promise<stdout>, criada por src/exec.js (local ou via ssh).
function criarFonte({ executor, database }) {
  const q = construtorQueries(database);

  // Conjunto de n_urls nominativas (para pular). Opcionalmente restrito a uma faixa.
  async function nominativos(min, max) {
    const out = await executor(`clickhouse-client --database ${database} --query "${q.nominativas(min, max)}" --format TabSeparated`);
    const set = new Set();
    for (const linha of out.split('\n')) { const t = linha.trim(); if (t) set.add(Number(t)); }
    return set;
  }

  async function maxNUrl() {
    const out = await executor(`clickhouse-client --database ${database} --query "${q.maxNUrl()}" --format TabSeparated`);
    return Number(out.trim());
  }

  async function marcarTemImagem(nUrls, lote = 5000) {
    for (let i = 0; i < nUrls.length; i += lote) {
      const slice = nUrls.slice(i, i + lote);
      await executor(`clickhouse-client --query "${q.updateTemImagem(slice)}"`);
    }
  }

  return { nominativos, maxNUrl, marcarTemImagem };
}

module.exports = { construtorQueries, criarFonte, montarSshArgs };
