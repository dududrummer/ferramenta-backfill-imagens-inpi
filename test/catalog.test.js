const { abrirCatalogo } = require('../src/catalog');

function novo() { return abrirCatalogo(':memory:'); }

test('marcar e obterStatus', () => {
  const c = novo();
  c.marcar(100, 'baixada', { ext: 'jpg', marcar_db: 1 });
  expect(c.obterStatus(100)).toMatchObject({ n_url: 100, status: 'baixada', ext: 'jpg', marcar_db: 1 });
  c.fechar();
});

test('jaProcessado é true para baixada/sem_imagem e false para falhou/ausente', () => {
  const c = novo();
  c.marcar(1, 'baixada', {});
  c.marcar(2, 'sem_imagem', {});
  c.marcar(3, 'falhou', {});
  expect(c.jaProcessado(1)).toBe(true);
  expect(c.jaProcessado(2)).toBe(true);
  expect(c.jaProcessado(3)).toBe(false);
  expect(c.jaProcessado(999)).toBe(false);
  c.fechar();
});

test('inserirExistentes marca em lote como baixada+uploaded', () => {
  const c = novo();
  c.inserirExistentes([10, 11, 12]);
  expect(c.jaProcessado(10)).toBe(true);
  expect(c.obterStatus(11)).toMatchObject({ status: 'baixada', uploaded: 1 });
  c.fechar();
});

test('pendentesParaUpload e pendentesParaMarcarDb', () => {
  const c = novo();
  c.marcar(20, 'baixada', { ext: 'png', uploaded: 0, marcar_db: 1 });
  c.marcar(21, 'baixada', { ext: 'jpg', uploaded: 1, marcar_db: 0 });
  expect(c.pendentesParaUpload().map(r => r.n_url)).toEqual([20]);
  expect(c.pendentesParaMarcarDb()).toEqual([20]);
  c.confirmarUpload([20]);
  c.confirmarMarcacaoDb([20]);
  expect(c.pendentesParaUpload()).toEqual([]);
  expect(c.pendentesParaMarcarDb()).toEqual([]);
  c.fechar();
});

test('estatisticas conta por status', () => {
  const c = novo();
  c.marcar(1, 'baixada', {});
  c.marcar(2, 'baixada', {});
  c.marcar(3, 'sem_imagem', {});
  expect(c.estatisticas()).toMatchObject({ baixada: 2, sem_imagem: 1 });
  c.fechar();
});
