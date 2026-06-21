const { execFile } = require('child_process');

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

function montarSshArgs(ssh) {
  const args = [];
  if (ssh.key) args.push('-i', ssh.key);
  if (ssh.port) args.push('-p', String(ssh.port));
  args.push(`${ssh.user}@${ssh.host}`);
  return args;
}

function rodarRemoto(ssh, comando, opts = {}) {
  const execFn = opts._execFile || execFile;
  return new Promise((resolve, reject) => {
    const args = [...montarSshArgs(ssh), comando];
    execFn('ssh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function criarFonte({ ssh, database }, opts = {}) {
  const q = construtorQueries(database);

  // Conjunto de n_urls nominativas (para pular). Opcionalmente restrito a uma faixa.
  async function nominativos(min, max) {
    const cmd = `clickhouse-client --database ${database} --query "${q.nominativas(min, max)}" --format TabSeparated`;
    const out = await rodarRemoto(ssh, cmd, opts);
    const set = new Set();
    for (const linha of out.split('\n')) {
      const t = linha.trim();
      if (t) set.add(Number(t));
    }
    return set;
  }

  async function maxNUrl() {
    const cmd = `clickhouse-client --database ${database} --query "${q.maxNUrl()}" --format TabSeparated`;
    const out = await rodarRemoto(ssh, cmd, opts);
    return Number(out.trim());
  }

  async function marcarTemImagem(nUrls, lote = 5000) {
    for (let i = 0; i < nUrls.length; i += lote) {
      const slice = nUrls.slice(i, i + lote);
      const cmd = `clickhouse-client --query "${q.updateTemImagem(slice)}"`;
      await rodarRemoto(ssh, cmd, opts);
    }
  }

  return { nominativos, maxNUrl, marcarTemImagem };
}

module.exports = { construtorQueries, criarFonte, montarSshArgs };
