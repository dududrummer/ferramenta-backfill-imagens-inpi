const https = require('https');
const { detectarExt, ehPlaceholder } = require('./image-detect');

const HOST = 'busca.inpi.gov.br';
const BASE_PATH = '/pePI';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function httpGet({ agent, path, timeoutMs }) {
  return new Promise((resolve) => {
    const req = https.request({
      host: HOST, path: BASE_PATH + path, method: 'GET', agent,
      headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*' },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, erro: 'timeout', buffer: null }); });
    req.on('error', (e) => resolve({ status: 0, erro: e.message, buffer: null }));
    req.end();
  });
}

async function baixarBuffer(circuito, nUrl, opts = {}) {
  const get = opts._httpGet || httpGet;
  return get({
    agent: circuito.agent,
    path: `/servlet/LogoMarcasServletController?Action=image&codProcesso=${nUrl}`,
    timeoutMs: opts.timeoutMs || 30000,
  });
}

function classificarResultado(res, placeholderHashes = []) {
  if (!res || res.status === 0 || res.status === 403 || res.status === 429) {
    return { resultado: 'bloqueio', erro: res && res.erro };
  }
  if (res.status >= 500) return { resultado: 'erro', erro: `http ${res.status}` };
  if (res.status !== 200 || !res.buffer || res.buffer.length === 0) {
    return { resultado: 'sem_imagem' };
  }
  const ext = detectarExt(res.buffer);
  if (!ext) return { resultado: 'sem_imagem' };
  if (ehPlaceholder(res.buffer, placeholderHashes)) return { resultado: 'sem_imagem' };
  return { resultado: 'baixada', ext, buffer: res.buffer };
}

module.exports = { baixarBuffer, classificarResultado, httpGet };
