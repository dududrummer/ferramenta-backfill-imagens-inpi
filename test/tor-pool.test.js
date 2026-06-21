const { criarPool } = require('../src/tor-pool');

test('proximoCircuito faz round-robin entre as portas', () => {
  const pool = criarPool({ torHost: '127.0.0.1', torSocksPorts: [9050, 9052], torControlPorts: [9051, 9053] });
  const a = pool.proximoCircuito();
  const b = pool.proximoCircuito();
  const c = pool.proximoCircuito();
  expect(a.socksPort).toBe(9050);
  expect(b.socksPort).toBe(9052);
  expect(c.socksPort).toBe(9050);
  expect(a.agent).toBeDefined();
});

test('os circuitos usam agente com keepAlive', () => {
  const { criarPool } = require('../src/tor-pool');
  const pool = criarPool({ torHost: '127.0.0.1', torSocksPorts: [9050], torControlPorts: [9051] });
  const c = pool.proximoCircuito();
  expect(c.agent).toBeDefined();
  // socks-proxy-agent expõe keepAlive quando habilitado
  expect(c.agent.keepAlive === true || (c.agent.options && c.agent.options.keepAlive === true)).toBe(true);
});

test('podeRotacionar respeita o cooldown', () => {
  const pool = criarPool({
    torHost: '127.0.0.1', torSocksPorts: [9050], torControlPorts: [9051], cooldownMs: 10000,
  });
  const circ = pool.proximoCircuito();
  expect(pool.podeRotacionar(circ, 0)).toBe(true);
  pool.registrarRotacao(circ, 1000);
  expect(pool.podeRotacionar(circ, 5000)).toBe(false);    // dentro do cooldown
  expect(pool.podeRotacionar(circ, 12000)).toBe(true);    // após o cooldown
});
