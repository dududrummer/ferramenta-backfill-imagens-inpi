const net = require('net');
const { SocksProxyAgent } = require('socks-proxy-agent');

function criarPool(opts) {
  const {
    torHost = '127.0.0.1', torSocksPorts, torControlPorts,
    torControlPassword = '', cooldownMs = 10000,
  } = opts;

  const circuitos = torSocksPorts.map((socksPort, i) => {
    const user = `slot${i + 1}`;
    const agent = new SocksProxyAgent(`socks5h://${user}:x@${torHost}:${socksPort}`);
    return { id: i, socksPort, controlPort: torControlPorts[i], agent, ultimaRotacao: -Infinity };
  });

  let idx = 0;
  function proximoCircuito() {
    const c = circuitos[idx % circuitos.length];
    idx++;
    return c;
  }

  function podeRotacionar(circ, agora = Date.now()) {
    return agora - circ.ultimaRotacao >= cooldownMs;
  }
  function registrarRotacao(circ, agora = Date.now()) {
    circ.ultimaRotacao = agora;
  }

  // Envia SIGNAL NEWNYM ao ControlPort do Tor (troca o IP de saída para conexões futuras).
  function newnym(circ) {
    return new Promise((resolve) => {
      if (!podeRotacionar(circ)) return resolve(false);
      let resolvido = false;
      let enviado = false;
      const finalizar = (v) => { if (!resolvido) { resolvido = true; resolve(v); } };
      const sock = net.connect(circ.controlPort, torHost);
      let buf = '';
      sock.setEncoding('utf8');
      sock.setTimeout(5000, () => { sock.destroy(); finalizar(false); });
      sock.on('error', () => finalizar(false));
      sock.on('connect', () => {
        sock.write(`AUTHENTICATE "${torControlPassword}"\r\n`);
      });
      sock.on('data', (d) => {
        buf += d;
        if (!enviado && buf.includes('250')) {
          enviado = true;
          sock.write('SIGNAL NEWNYM\r\nQUIT\r\n');
          registrarRotacao(circ);
          finalizar(true);
        } else if (!enviado && /(^|\n)5\d\d/.test(buf)) {
          // erro de controle/autenticação (ex.: 515/551)
          sock.destroy();
          finalizar(false);
        }
      });
      // Se fechar sem termos enviado o NEWNYM, considere falha.
      sock.on('close', () => finalizar(enviado));
    });
  }

  return { circuitos, proximoCircuito, podeRotacionar, registrarRotacao, newnym };
}

module.exports = { criarPool };
