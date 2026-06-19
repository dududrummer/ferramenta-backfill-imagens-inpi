const { createClient } = require('@clickhouse/client');

function construtorQueries(database) {
  const T = `${database}.marcas`;
  return {
    fase1() {
      return `SELECT DISTINCT n_url FROM ${T} WHERE tem_imagem = 1 AND n_url > 0 ORDER BY n_url`;
    },
    fase2(min, max) {
      let w = 'tem_imagem = 0 AND n_url > 0';
      if (min != null && max != null) w += ` AND n_url >= ${min} AND n_url <= ${max}`;
      return `SELECT DISTINCT n_url FROM ${T} WHERE ${w} ORDER BY n_url`;
    },
    updateTemImagem(nUrls) {
      return `ALTER TABLE ${T} UPDATE tem_imagem=1 WHERE n_url IN (${nUrls.join(',')})`;
    },
  };
}

function criarClient(cfg) {
  return createClient({
    url: `http://${cfg.host}:${cfg.port}`,
    database: cfg.database, username: cfg.user, password: cfg.password,
  });
}

function criarFonte({ client, database }) {
  const q = construtorQueries(database);

  async function rodar(sql) {
    const rs = await client.query({ query: sql, format: 'JSONEachRow' });
    const rows = await rs.json();
    return rows.map(r => Number(r.n_url));
  }

  async function candidatosFase1() { return rodar(q.fase1()); }
  async function candidatosFase2(min, max) { return rodar(q.fase2(min, max)); }

  async function marcarTemImagem(nUrls, lote = 5000) {
    for (let i = 0; i < nUrls.length; i += lote) {
      const slice = nUrls.slice(i, i + lote);
      await client.command({ query: q.updateTemImagem(slice) });
    }
  }

  return { candidatosFase1, candidatosFase2, marcarTemImagem };
}

module.exports = { construtorQueries, criarFonte, criarClient };
