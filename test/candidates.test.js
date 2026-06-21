const { construtorQueries, criarFonte, montarSshArgs } = require('../src/candidates');

test('nominativas e maxNUrl montam o SQL certo', () => {
  const q = construtorQueries('neopi');
  expect(q.nominativas()).toMatch(/apresentacao = 'Nominativa'/);
  expect(q.nominativas()).toMatch(/FROM neopi\.marcas/);
  expect(q.nominativas(100, 200)).toMatch(/n_url >= 100 AND n_url <= 200/);
  expect(q.maxNUrl()).toBe('SELECT max(n_url) FROM neopi.marcas');
});

test('updateTemImagem monta o ALTER ... UPDATE com IN', () => {
  const q = construtorQueries('neopi');
  expect(q.updateTemImagem([1, 2, 3])).toBe('ALTER TABLE neopi.marcas UPDATE tem_imagem=1 WHERE n_url IN (1,2,3)');
});

test('montarSshArgs inclui chave, porta e destino', () => {
  expect(montarSshArgs({ host: 'h', user: 'u', key: '/k', port: 2222 })).toEqual(['-i', '/k', '-p', '2222', 'u@h']);
  expect(montarSshArgs({ host: 'h', user: 'u' })).toEqual(['u@h']);
});

test('nominativos retorna um Set de n_urls', async () => {
  const fakeExec = (bin, args, o, cb) => cb(null, '10\n11\n12\n');
  const fonte = criarFonte({ ssh: { host: 'h', user: 'u' }, database: 'neopi' }, { _execFile: fakeExec });
  const set = await fonte.nominativos();
  expect(set.has(11)).toBe(true);
  expect(set.size).toBe(3);
});

test('maxNUrl retorna número', async () => {
  const fakeExec = (bin, args, o, cb) => cb(null, '6497967\n');
  const fonte = criarFonte({ ssh: { host: 'h', user: 'u' }, database: 'neopi' }, { _execFile: fakeExec });
  expect(await fonte.maxNUrl()).toBe(6497967);
});

test('marcarTemImagem executa em lotes', async () => {
  const cmds = [];
  const fakeExec = (bin, args, o, cb) => { cmds.push(args[args.length - 1]); cb(null, ''); };
  const fonte = criarFonte({ ssh: { host: 'h', user: 'u' }, database: 'neopi' }, { _execFile: fakeExec });
  await fonte.marcarTemImagem([1, 2, 3, 4, 5], 2);
  expect(cmds.length).toBe(3);
  expect(cmds[0]).toContain('IN (1,2)');
});
