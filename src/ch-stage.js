// Acumula os docs parseados e grava em LOTE nas tabelas de staging `*_rerasp` do droplet, via
// `clickhouse-client` (no servidor por SSH no modo remoto, ou local no modo servidor). Só INSERT
// (FORMAT JSONEachRow por stdin) — as 12 máquinas escrevem concorrentes sem DELETE/mutations.
const { spawn } = require('child_process');
const { montarSshArgs } = require('./exec');

// Mesma lista (e ordem) de @neopi/shared CLONE_TABLES.
const TABELAS = [
  'marcas', 'marcas_despachos', 'marcas_titulares', 'marcas_representantes',
  'marcas_classificacoes', 'marcas_viena', 'marcas_prioridades', 'marcas_prazos', 'marcas_peticoes',
];

// Roda `clickhouse-client ... INSERT ... FORMAT JSONEachRow` e manda o NDJSON pelo stdin.
function inserir(cfg, tabela, ndjson) {
  return new Promise((resolve, reject) => {
    const db = cfg.ch.database;
    const remoto = `clickhouse-client --database ${db} --query "INSERT INTO ${db}.${tabela}_rerasp FORMAT JSONEachRow"`;
    const [bin, args] = cfg.modo === 'servidor'
      ? ['bash', ['-c', remoto]]
      : ['ssh', [...montarSshArgs(cfg.ssh), remoto]];
    const p = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`CH insert ${tabela}: ${err.trim() || 'exit ' + code}`)));
    p.stdin.on('error', () => {});   // evita EPIPE se o ssh fechar antes
    p.stdin.end(ndjson);
  });
}

function criarStager(cfg) {
  const buf = Object.fromEntries(TABELAS.map(t => [t, []]));
  let pend = 0;
  return {
    add(parsed) {
      for (const t of TABELAS) {
        const v = parsed[t];
        if (t === 'marcas') { if (v) buf[t].push(v); }
        else if (Array.isArray(v)) buf[t].push(...v);
      }
      pend++;
    },
    pendentes() { return pend; },
    async flush() {
      // Snapshot SÍNCRONO: troca os buffers por novos antes de qualquer await, para não perder
      // linhas que os workers adicionarem durante o INSERT (que tem awaits de SSH).
      const snap = {};
      for (const t of TABELAS) { snap[t] = buf[t]; buf[t] = []; }
      pend = 0;
      for (const t of TABELAS) {
        if (!snap[t].length) continue;
        await inserir(cfg, t, snap[t].map(r => JSON.stringify(r)).join('\n') + '\n');
      }
    },
  };
}

module.exports = { criarStager, TABELAS };
