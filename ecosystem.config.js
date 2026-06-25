// PM2: re-raspagem de despachos por Tor, 1 processo por faixa. Cada app pega uma fatia das portas
// Tor + uma sub-faixa de n_url + catálogo próprio (retomável). Gere com NUM_PROC/PORTAS_POR_PROC/
// CONC_POR_PROC/MIN/MAX no ambiente (mesmos defaults do servidor/pm2-up.sh).
//   NUM_PROC=8 PORTAS_POR_PROC=3 CONC_POR_PROC=50 pm2 start ecosystem.config.js
//
// SSH/CH/REMOTE_IMAGE_DIR vêm do .env (dotenv); BACKEND/TOR_*/CONCURRENCY/CATALOG são setados aqui
// (env do PM2 tem precedência sobre o .env). stop_exit_codes:[0] = quando a faixa TERMINA (exit 0),
// o PM2 NÃO reinicia; se CRASHAR (exit !=0), reinicia e retoma pelo catálogo.
const N    = parseInt(process.env.NUM_PROC || '8', 10);
const PPP  = parseInt(process.env.PORTAS_POR_PROC || '3', 10);
const CONC = process.env.CONC_POR_PROC || '50';
const MIN  = parseInt(process.env.MIN || '4145', 10);
const MAX  = parseInt(process.env.MAX || '7000000', 10);
const SPAN = Math.floor((MAX - MIN + 1) / N);

const apps = [];
for (let i = 0; i < N; i++) {
  const A = MIN + i * SPAN;
  const B = i === N - 1 ? MAX : MIN + (i + 1) * SPAN - 1;
  const s = i * PPP;
  const socks = [], control = [];
  for (let j = 0; j < PPP; j++) { socks.push(9050 + (s + j) * 2); control.push(9051 + (s + j) * 2); }
  apps.push({
    name: `desp-${i}`,
    script: './src/cli.js',
    args: `run-despachos --range ${A}-${B}`,
    cwd: __dirname,
    autorestart: true,
    stop_exit_codes: [0],
    max_restarts: 100000,
    restart_delay: 10000,
    out_file: `logs/desp-${i}.out`,
    error_file: `logs/desp-${i}.err`,
    merge_logs: true,
    env: {
      BACKEND: 'tor',
      TOR_SOCKS_PORTS: socks.join(','),
      TOR_CONTROL_PORTS: control.join(','),
      CONCURRENCY: CONC,
      CATALOG_PATH: `catalogos/desp_${i}.sqlite`,
    },
  });
}

module.exports = { apps };
