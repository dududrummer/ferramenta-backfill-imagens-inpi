const { construtorQueries, criarFonte } = require('../src/candidates');

test('queries de candidatos por fase', () => {
  const q = construtorQueries('neopi');
  expect(q.fase1()).toMatch(/tem_imagem\s*=\s*1/);
  expect(q.fase1()).toMatch(/FROM neopi\.marcas/);
  expect(q.fase2()).toMatch(/tem_imagem\s*=\s*0/);
  expect(q.fase2(100, 200)).toMatch(/n_url\s*>=\s*100 AND n_url\s*<=\s*200/);
});

test('updateTemImagem monta o ALTER ... UPDATE com IN', () => {
  const q = construtorQueries('neopi');
  expect(q.updateTemImagem([1, 2, 3]))
    .toBe('ALTER TABLE neopi.marcas UPDATE tem_imagem=1 WHERE n_url IN (1,2,3)');
});

test('criarFonte.candidatos delega ao client e retorna n_urls', async () => {
  const fakeClient = {
    query: async () => ({ json: async () => [{ n_url: 5 }, { n_url: 6 }] }),
  };
  const fonte = criarFonte({ client: fakeClient, database: 'neopi' });
  expect(await fonte.candidatosFase1()).toEqual([5, 6]);
});

test('criarFonte.marcarTemImagem executa em lotes', async () => {
  const executados = [];
  const fakeClient = { command: async ({ query }) => { executados.push(query); } };
  const fonte = criarFonte({ client: fakeClient, database: 'neopi' });
  await fonte.marcarTemImagem([1, 2, 3, 4, 5], 2);   // lotes de 2
  expect(executados.length).toBe(3);
  expect(executados[0]).toContain('IN (1,2)');
  expect(executados[2]).toContain('IN (5)');
});
