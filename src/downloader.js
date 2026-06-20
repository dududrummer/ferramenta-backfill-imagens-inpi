const { httpDownload } = require('./http-session');
const { detectarExt, ehPlaceholder } = require('./image-detect');

async function baixarBuffer(circuito, nUrl, opts = {}) {
  const get = opts._httpGet || httpDownload;
  return get({
    agent: circuito.agent,
    jar: circuito.jar,
    path: `/servlet/LogoMarcasServletController?Action=image&codProcesso=${nUrl}`,
    timeoutMs: opts.timeoutMs || 30000,
  });
}

function classificarResultado(res, placeholderHashes = []) {
  if (!res || res.status === 0 || res.status === 403 || res.status === 429) {
    return { resultado: 'bloqueio', erro: res && res.erro };
  }
  // 3xx no servlet da imagem = sessão expirada/ausente → precisa re-aquecer e re-tentar
  if (res.status >= 300 && res.status < 400) return { resultado: 'sessao' };
  if (res.status >= 500) return { resultado: 'erro', erro: `http ${res.status}` };
  if (res.status !== 200 || !res.buffer || res.buffer.length === 0) {
    return { resultado: 'sem_imagem' };
  }
  const ext = detectarExt(res.buffer);
  if (!ext) return { resultado: 'sem_imagem' };
  if (ehPlaceholder(res.buffer, placeholderHashes)) return { resultado: 'sem_imagem' };
  return { resultado: 'baixada', ext, buffer: res.buffer };
}

module.exports = { baixarBuffer, classificarResultado };
