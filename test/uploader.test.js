const { montarArgsRsync } = require('../src/uploader');

test('montarArgsRsync inclui staging, destino e ssh com chave/porta', () => {
  const args = montarArgsRsync({
    staging: './staging', ssh: { host: 'srv', user: 'deploy', key: '/k', port: 2222 },
    remoteImageDir: '/var/neopi/bancoImagensINPI',
  });
  expect(args).toContain('-a');
  // origem com barra final (mescla conteúdo)
  expect(args).toContain('./staging/');
  expect(args).toContain('deploy@srv:/var/neopi/bancoImagensINPI/');
  const eIdx = args.indexOf('-e');
  expect(eIdx).toBeGreaterThan(-1);
  expect(args[eIdx + 1]).toContain('ssh -i /k -p 2222');
});
