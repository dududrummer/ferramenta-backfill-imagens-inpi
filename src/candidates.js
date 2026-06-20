const { execFile } = require('child_process');

function construtorQueries(database) {
  const T = `${database}.marcas`;
  return {
    // Marcas NÃO puramente nominativas (essas têm logo). Exclui só 'Nominativa' pura;
    // apresentação em branco/desconhecida É incluída (tenta baixar mesmo assim).
    // Dedup por n_url (MergeTree pode ter linhas repetidas); tem = 1 se qualquer linha já marca imagem.
    naoNominativas(min, max) {
      let w = "apresentacao != 'Nominativa' AND n_url > 0";
      if (min != null && max != null) w += ` AND n_url >= ${min} AND n_url <= ${max}`;
      return `SELECT n_url, max(tem_imagem) AS tem FROM ${T} WHERE ${w} GROUP BY n_url ORDER BY n_url`;
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

  // Retorna [{ n_url, temImagem }] das marcas não-nominativas (opcionalmente numa faixa).
  async function candidatos(min, max) {
    const cmd = `clickhouse-client --database ${database} --query "${q.naoNominativas(min, max)}" --format TabSeparated`;
    const out = await rodarRemoto(ssh, cmd, opts);
    return out.split('\n').map(s => s.trim()).filter(Boolean).map((linha) => {
      const [n, tem] = linha.split('\t');
      return { n_url: Number(n), temImagem: tem === '1' };
    });
  }

  async function marcarTemImagem(nUrls, lote = 5000) {
    for (let i = 0; i < nUrls.length; i += lote) {
      const slice = nUrls.slice(i, i + lote);
      const cmd = `clickhouse-client --query "${q.updateTemImagem(slice)}"`;
      await rodarRemoto(ssh, cmd, opts);
    }
  }

  return { candidatos, marcarTemImagem };
}

module.exports = { construtorQueries, criarFonte, montarSshArgs };
