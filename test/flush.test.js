const fs = require('fs');
const os = require('os');
const path = require('path');
const { flush } = require('../src/cli');
const { caminhoImagem } = require('../src/sharding');

function escreverArquivo(nUrl, ext, base) {
  const dest = caminhoImagem(nUrl, base, ext);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from([0xFF, 0xD8, 0xFF]));
  return dest;
}

test('flush envia, confirma e apaga só os arquivos do snapshot (preserva escritas concorrentes)', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'flush-'));
  const f1 = escreverArquivo(100, 'jpg', base);   // no snapshot -> enviado e apagado
  const confirmados = [];
  const catalogoFake = {
    pendentesParaUpload: () => [{ n_url: 100, ext: 'jpg' }],
    confirmarUpload: (ns) => confirmados.push(...ns),
    pendentesParaMarcarDb: () => [],
    confirmarMarcacaoDb: () => {},
  };
  const fonteFake = { marcarTemImagem: async () => {} };
  let novo;
  const cfg = { localStaging: base, chUpdateBatch: 100 };
  await flush(cfg, catalogoFake, fonteFake, {
    // simula uma escrita concorrente de outro worker durante o "rsync"
    _sincronizar: async () => { novo = escreverArquivo(200, 'png', base); },
  });
  expect(confirmados).toEqual([100]);
  expect(fs.existsSync(f1)).toBe(false);    // arquivo do snapshot foi apagado
  expect(fs.existsSync(novo)).toBe(true);   // escrita concorrente preservada
});

test('flush grava tem_imagem em lote e confirma', async () => {
  const marcados = [];
  let confirmou = false;
  const catalogoFake = {
    pendentesParaUpload: () => [],
    confirmarUpload: () => {},
    pendentesParaMarcarDb: () => [1, 2, 3],
    confirmarMarcacaoDb: () => { confirmou = true; },
  };
  const fonteFake = { marcarTemImagem: async (ns) => { marcados.push(ns); } };
  await flush({ localStaging: '.', chUpdateBatch: 5000 }, catalogoFake, fonteFake, {});
  expect(marcados[0]).toEqual([1, 2, 3]);
  expect(confirmou).toBe(true);
});
