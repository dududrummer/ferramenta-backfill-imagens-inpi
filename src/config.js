require('dotenv').config();
const path = require('path');

function parsePortas(s) {
  return String(s || '').split(',').map(p => parseInt(p.trim(), 10)).filter(p => p > 0);
}

function exigir(env, nome) {
  if (!env[nome]) throw new Error(`Variável obrigatória ausente: ${nome}`);
  return env[nome];
}

function carregarConfig(env = process.env) {
  const torSocksPorts = parsePortas(env.TOR_SOCKS_PORTS);
  const torControlPorts = parsePortas(env.TOR_CONTROL_PORTS);
  if (torSocksPorts.length === 0) throw new Error('TOR_SOCKS_PORTS vazio');
  if (torSocksPorts.length !== torControlPorts.length) {
    throw new Error('Número de portas SOCKS e CONTROL deve ser igual');
  }
  return {
    ssh: {
      host: exigir(env, 'SSH_HOST'),
      user: exigir(env, 'SSH_USER'),
      key: env.SSH_KEY || null,
      port: parseInt(env.SSH_PORT || '22', 10),
    },
    remoteImageDir: exigir(env, 'REMOTE_IMAGE_DIR'),
    ch: {
      host: env.CH_HOST || 'localhost',
      port: parseInt(env.CH_PORT || '8123', 10),
      database: env.CH_DATABASE || 'neopi',
      user: env.CH_USER || 'default',
      password: env.CH_PASSWORD || '',
    },
    torSocksPorts,
    torControlPorts,
    torControlPassword: env.TOR_CONTROL_PASSWORD || '',
    torHost: env.TOR_HOST || '127.0.0.1',
    concurrency: parseInt(env.CONCURRENCY || '8', 10),
    ratePerCircuit: parseFloat(env.RATE_PER_CIRCUIT || '2'),
    maxTentativas: parseInt(env.MAX_TENTATIVAS || '3', 10),
    localStaging: env.LOCAL_STAGING || './staging',
    catalogPath: env.CATALOG_PATH || './catalogo.sqlite',
    eventsLog: env.EVENTS_LOG || path.join(path.dirname(env.CATALOG_PATH || './catalogo.sqlite'), 'eventos.log'),
    rsyncBatch: parseInt(env.RSYNC_BATCH || '2000', 10),
    chUpdateBatch: parseInt(env.CH_UPDATE_BATCH || '5000', 10),
    placeholderHashes: parsePortasComoTexto(env.PLACEHOLDER_HASHES),
    timeoutMs: parseInt(env.TIMEOUT_MS || '30000', 10),
  };
}

function parsePortasComoTexto(s) {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
}

module.exports = { carregarConfig };
