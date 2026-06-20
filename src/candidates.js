const { execFile } = require('child_process');

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

function montarSshArgs(ssh) {
  const args = [];
  if (ssh.key) args.push('-i', ssh.key);
  if (ssh.port) args.push('-p', String(ssh.port));
  args.push(`${ssh.user}@${ssh.host}`);
  return args;
}

// Roda um comando no servidor via ssh e resolve o stdout.
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

  async function rodarSelect(sql) {
    const cmd = `clickhouse-client --database ${database} --query "${sql}" --format TabSeparated`;
    const out = await rodarRemoto(ssh, cmd, opts);
    return out.split('\n').map(s => s.trim()).filter(Boolean).map(Number);
  }

  async function candidatosFase1() { return rodarSelect(q.fase1()); }
  async function candidatosFase2(min, max) { return rodarSelect(q.fase2(min, max)); }

  async function marcarTemImagem(nUrls, lote = 5000) {
    for (let i = 0; i < nUrls.length; i += lote) {
      const slice = nUrls.slice(i, i + lote);
      const cmd = `clickhouse-client --query "${q.updateTemImagem(slice)}"`;
      await rodarRemoto(ssh, cmd, opts);
    }
  }

  return { candidatosFase1, candidatosFase2, marcarTemImagem };
}

module.exports = { construtorQueries, criarFonte, montarSshArgs };
