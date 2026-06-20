// Sessão pePI (cookies) para o INPI — espelha o app original (worker/src/updater/http-session.js).
const https = require('https');

const BASE = 'https://busca.inpi.gov.br/pePI';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const WARMUP_PROC = '821010000';

function parseSetCookie(line) {
  const first = String(line).split(';')[0];
  const eq = first.indexOf('=');
  if (eq < 0) return null;
  return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
}

class CookieJar {
  constructor() { this.cookies = {}; }
  setFromHeaders(arr) {
    for (const line of [].concat(arr || [])) {
      const c = parseSetCookie(line);
      if (c && c.name) this.cookies[c.name] = c.value;
    }
  }
  header() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
}

function isSessionExpired(status, html) {
  if (status === 302) return true;
  return /name="T_Login"/i.test(html || '');
}

// Requisição de texto (warmup). Captura set-cookie no jar e manda Cookie.
function httpRequest(agent, { method, path, body, jar, referer, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Cookie': jar.header() };
    if (referer) headers['Referer'] = referer;
    if (body != null) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(`${BASE}${path}`, { method, agent, headers, timeout: timeoutMs || 30000 }, (res) => {
      if (res.headers['set-cookie']) jar.setFromHeaders(res.headers['set-cookie']);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers['location'] || '', html: Buffer.concat(chunks).toString('latin1') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body != null) req.write(body);
    req.end();
  });
}

// Download binário (imagem) com os cookies da sessão. Assinatura de objeto único
// para casar com a injeção de teste do downloader. Resolve (não rejeita) em erro/timeout.
function httpDownload({ agent, path, jar, timeoutMs }) {
  return new Promise((resolve) => {
    const headers = { 'User-Agent': UA, 'Accept': 'image/*,*/*', 'Cookie': jar ? jar.header() : '' };
    const req = https.request(`${BASE}${path}`, { method: 'GET', agent, headers, timeout: timeoutMs || 30000 }, (res) => {
      if (jar && res.headers['set-cookie']) jar.setFromHeaders(res.headers['set-cookie']);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '') }));
    });
    req.on('error', (e) => resolve({ status: 0, erro: e.message, buffer: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, erro: 'timeout', buffer: null }); });
    req.end();
  });
}

// Aquece a sessão pePI no circuito (4 requisições) e guarda os cookies em circ.jar.
// _req permite injetar httpRequest nos testes. Define circ.warm e retorna o booleano.
async function warmSession(circ, timeoutMs = 30000, _req) {
  const req = _req || httpRequest;
  const { agent, jar } = circ;
  await req(agent, { method: 'GET', path: '/', jar, timeoutMs });
  await req(agent, { method: 'POST', path: '/servlet/LoginController', body: 'T_Login=&T_Senha=&action=login&Usuario=', jar, referer: `${BASE}/`, timeoutMs });
  await req(agent, { method: 'GET', path: '/jsp/marcas/Pesquisa_num_processo.jsp', jar, timeoutMs });
  const r = await req(agent, { method: 'POST', path: '/servlet/MarcasServletController', body: `Action=searchMarca&tipoPesquisa=BY_NUM_PROC&NumPedido=${WARMUP_PROC}&NumGRU=&NumProtocolo=&NumInscricaoInternacional=`, jar, referer: `${BASE}/jsp/marcas/Pesquisa_num_processo.jsp`, timeoutMs });
  circ.warm = !isSessionExpired(r.status, r.html);
  return circ.warm;
}

module.exports = { BASE, UA, CookieJar, parseSetCookie, isSessionExpired, httpRequest, httpDownload, warmSession };
