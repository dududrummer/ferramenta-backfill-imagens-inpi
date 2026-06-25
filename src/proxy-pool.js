// Pool de PROXY (ex.: DataImpulse) — drop-in do tor-pool. Cada "circuito" é uma STICKY SESSION
// (mesmo IP por um lote de requisições); "newnym" = trocar a sticky session → novo IP de saída.
// O usuário sticky vem do template do .env (PROXY_USER_TEMPLATE) com {session} onde vai o id.
const { SocksProxyAgent } = require('socks-proxy-agent');
let HttpsProxyAgent;
try { ({ HttpsProxyAgent } = require('https-proxy-agent')); } catch (_) { /* só necessário p/ PROXY_PROTOCOL=http */ }
const { CookieJar } = require('./http-session');

function gerarSession() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Preenche {session} no template; sem {session} => proxy rotativo (IP novo a cada conexão).
function montarUser(template, session) {
  return String(template).includes('{session}') ? String(template).split('{session}').join(session) : String(template);
}

function criarAgente(cfg, user) {
  const { host, port, pass, protocol } = cfg.proxy;
  // encodeURIComponent garante que ';' '.' ',' do usuário sticky cheguem literais ao proxy
  // (new URL decodifica de volta), sem quebrar o parse da URL.
  const cred = `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`;
  // keepAlive DESLIGADO no proxy remoto: a DataImpulse fecha conexões reusadas, e o Node reaproveitar
  // um socket morto gera "Socket closed". Conexão nova por requisição é robusto; a sticky session
  // (mesmo IP) é mantida pelo USUÁRIO, não pela conexão. (No Tor local, keepAlive funciona — por isso
  // o tor-pool mantém.)
  const agOpts = { keepAlive: false, maxSockets: 64, timeout: 60000 };
  if (protocol === 'http') {
    if (!HttpsProxyAgent) throw new Error('PROXY_PROTOCOL=http exige o pacote https-proxy-agent');
    return new HttpsProxyAgent(`http://${cred}@${host}:${port}`, agOpts);
  }
  return new SocksProxyAgent(`socks5h://${cred}@${host}:${port}`, agOpts);
}

function criarPoolProxy(cfg) {
  const tam = Math.max(1, cfg.proxy.poolSize || cfg.concurrency);
  const circuitos = Array.from({ length: tam }, (_, i) => {
    const session = gerarSession();
    return { id: i, session, agent: criarAgente(cfg, montarUser(cfg.proxy.userTemplate, session)), ultimaRotacao: -Infinity, jar: new CookieJar(), warm: false };
  });

  let idx = 0;
  const proximoCircuito = () => { const c = circuitos[idx % circuitos.length]; idx++; return c; };
  const podeRotacionar = () => true;   // proxy não tem cooldown de NEWNYM
  const registrarRotacao = (circ) => { circ.ultimaRotacao = Date.now(); };

  async function newnym(circ) {
    circ.session = gerarSession();
    circ.agent = criarAgente(cfg, montarUser(cfg.proxy.userTemplate, circ.session));
    circ.jar = new CookieJar();   // IP mudou → sessão pePI (cookies) tem que ser refeita
    circ.warm = false;
    registrarRotacao(circ);
    return true;
  }

  return { circuitos, proximoCircuito, podeRotacionar, registrarRotacao, newnym };
}

module.exports = { criarPoolProxy, gerarSession, montarUser };
