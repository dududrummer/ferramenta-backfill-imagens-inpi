const { montarUser, gerarSession } = require('../src/proxy-pool');
const { carregarConfig } = require('../src/config');

test('montarUser preenche {session} (sticky) ou mantém literal (rotativo)', () => {
  expect(montarUser('login__cr.br;sessid.{session}', 'ABC')).toBe('login__cr.br;sessid.ABC');
  expect(montarUser('login_rotativo', 'ABC')).toBe('login_rotativo');
});
test('gerarSession dá ids distintos', () => {
  expect(gerarSession()).not.toBe(gerarSession());
});
test('BACKEND=proxy exige credenciais e popula cfg.proxy', () => {
  expect(() => carregarConfig({ BACKEND: 'proxy', MODO: 'servidor', IMAGE_DIR: '/x' })).toThrow(/PROXY_HOST/);
  const c = carregarConfig({ BACKEND: 'proxy', MODO: 'servidor', IMAGE_DIR: '/x', PROXY_HOST: 'gw.dataimpulse.com', PROXY_PORT: '823', PROXY_USER_TEMPLATE: 'u;sessid.{session}', PROXY_PASS: 'p' });
  expect(c.backend).toBe('proxy');
  expect(c.proxy.host).toBe('gw.dataimpulse.com');
  expect(c.proxy.port).toBe(823);
});
test('BACKEND=tor (padrão) segue exigindo TOR_SOCKS_PORTS', () => {
  expect(() => carregarConfig({ MODO: 'servidor', IMAGE_DIR: '/x' })).toThrow(/TOR_SOCKS_PORTS/);
});
