const { filtrarPendentes, salvarImagem } = require('../src/runner');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('filtrarPendentes remove o que já foi processado no catálogo', () => {
  const catalogo = { jaProcessado: (n) => n === 2 };
  const cands = [{ n_url: 1 }, { n_url: 2 }, { n_url: 3 }];
  expect(filtrarPendentes(cands, catalogo)).toEqual([{ n_url: 1 }, { n_url: 3 }]);
});

test('salvarImagem grava no caminho sharded e retorna a extensão', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
  const dest = salvarImagem(449552, buf, 'jpg', base);
  expect(dest).toBe(path.join(base, '0', '449', '449552.jpg'));
  expect(fs.existsSync(dest)).toBe(true);
});
