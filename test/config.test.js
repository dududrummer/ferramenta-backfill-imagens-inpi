const { carregarConfig } = require('../src/config');

const baseEnv = {
  SSH_HOST: 'srv', SSH_USER: 'deploy', REMOTE_IMAGE_DIR: '/var/neopi/bancoImagensINPI',
  CH_HOST: 'localhost', CH_PORT: '8123', CH_DATABASE: 'neopi',
  TOR_SOCKS_PORTS: '9050,9052', TOR_CONTROL_PORTS: '9051,9053',
};

test('carregarConfig parseia portas e numéricos com defaults', () => {
  const c = carregarConfig(baseEnv);
  expect(c.torSocksPorts).toEqual([9050, 9052]);
  expect(c.torControlPorts).toEqual([9051, 9053]);
  expect(c.concurrency).toBe(8);            // default
  expect(c.ch.port).toBe(8123);
});

test('carregarConfig falha se faltar variável obrigatória', () => {
  const incompleto = { ...baseEnv };
  delete incompleto.SSH_HOST;
  expect(() => carregarConfig(incompleto)).toThrow(/SSH_HOST/);
});

test('quantidades de portas SOCKS e CONTROL devem bater', () => {
  expect(() => carregarConfig({ ...baseEnv, TOR_CONTROL_PORTS: '9051' }))
    .toThrow(/portas/);
});

test('modo servidor usa imageDir como base das imagens', () => {
  const c = carregarConfig({ ...baseEnv, MODO: 'servidor', REMOTE_IMAGE_DIR: '/var/neopi/bancoImagensINPI' });
  expect(c.modo).toBe('servidor');
  expect(c.baseImagens).toBe('/var/neopi/bancoImagensINPI');
});

test('modo remoto (default) usa localStaging como base', () => {
  const c = carregarConfig({ ...baseEnv, LOCAL_STAGING: './staging' });
  expect(c.modo).toBe('remoto');
  expect(c.baseImagens).toBe('./staging');
});
