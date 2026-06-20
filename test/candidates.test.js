const { construtorQueries, criarFonte, montarSshArgs } = require('../src/candidates');

test('naoNominativas exclui só Nominativa pura (inclui em branco), com dedup', () => {
  const q = construtorQueries('neopi');
  const sql = q.naoNominativas();
  expect(sql).toMatch(/apresentacao != 'Nominativa'/);
  expect(sql).not.toMatch(/apresentacao != ''/);   // branco/desconhecido é incluído
  expect(sql).toMatch(/FROM neopi\.marcas/);
  expect(sql).toMatch(/GROUP BY n_url/);
  expect(q.naoNominativas(100, 200)).toMatch(/n_url\s*>=\s*100 AND n_url\s*<=\s*200/);
});

test('updateTemImagem monta o ALTER ... UPDATE com IN', () => {
  const q = construtorQueries('neopi');
  expect(q.updateTemImagem([1, 2, 3]))
    .toBe('ALTER TABLE neopi.marcas UPDATE tem_imagem=1 WHERE n_url IN (1,2,3)');
});

test('montarSshArgs inclui chave, porta e destino', () => {
  expect(montarSshArgs({ host: 'h', user: 'u', key: '/k', port: 2222 }))
    .toEqual(['-i', '/k', '-p', '2222', 'u@h']);
  expect(montarSshArgs({ host: 'h', user: 'u' })).toEqual(['u@h']);
});

test('candidatos roda clickhouse-client via ssh e retorna {n_url, temImagem}', async () => {
  let comando = null;
  const fakeExec = (bin, args, optsX, cb) => { comando = args[args.length - 1]; cb(null, '5\t1\n6\t0\n'); };
  const fonte = criarFonte({ ssh: { host: 'h', user: 'u' }, database: 'neopi' }, { _execFile: fakeExec });
  expect(await fonte.candidatos()).toEqual([
    { n_url: 5, temImagem: true },
    { n_url: 6, temImagem: false },
  ]);
  expect(comando).toContain('clickhouse-client');
  expect(comando).toContain("apresentacao != 'Nominativa'");
});

test('marcarTemImagem executa em lotes via ssh', async () => {
  const comandos = [];
  const fakeExec = (bin, args, optsX, cb) => { comandos.push(args[args.length - 1]); cb(null, ''); };
  const fonte = criarFonte({ ssh: { host: 'h', user: 'u' }, database: 'neopi' }, { _execFile: fakeExec });
  await fonte.marcarTemImagem([1, 2, 3, 4, 5], 2);
  expect(comandos.length).toBe(3);
  expect(comandos[0]).toContain('IN (1,2)');
  expect(comandos[2]).toContain('IN (5)');
});
