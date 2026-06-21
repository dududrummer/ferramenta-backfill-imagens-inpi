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
  const modo = (env.MODO || 'remoto');
  const imageDir = env.IMAGE_DIR || env.REMOTE_IMAGE_DIR;
  // Validação condicional ao modo: servidor não precisa de SSH; remoto precisa.
  if (modo === 'servidor') {
    if (!imageDir) throw new Error('No modo servidor, defina IMAGE_DIR (ou REMOTE_IMAGE_DIR) com a pasta das imagens');
  } else {
    exigir(env, 'SSH_HOST');
    exigir(env, 'SSH_USER');
    exigir(env, 'REMOTE_IMAGE_DIR');
  }
  return {
    ssh: {
      host: env.SSH_HOST || null,
      user: env.SSH_USER || null,
      key: env.SSH_KEY || null,
      port: parseInt(env.SSH_PORT || '22', 10),
    },
    modo,
    imageDir,
    baseImagens: modo === 'servidor' ? imageDir : (env.LOCAL_STAGING || './staging'),
    remoteImageDir: env.REMOTE_IMAGE_DIR || imageDir || null,
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
    maxReqPorCircuito: parseInt(env.MAX_REQ_POR_CIRCUITO || '18', 10),
    marcarTemImagem: env.MARCAR_TEM_IMAGEM === '1',
    placeholderHashes: parsePortasComoTexto(env.PLACEHOLDER_HASHES),
    timeoutMs: parseInt(env.TIMEOUT_MS || '30000', 10),
  };
}

function parsePortasComoTexto(s) {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
}

module.exports = { carregarConfig };
