const fs   = require('fs');
const path = require('path');
const { parseDetailFull } = require('../src/parser-html');

const FIX = path.join(__dirname, 'fixtures');
const doc = (f, cod) => parseDetailFull(fs.readFileSync(path.join(FIX, f), 'latin1'), cod);

test('parseDetailFull extrai marca + despachos com COMPLEMENTO (parser portado do worker)', () => {
  const d = doc('detail_938063561.html', 938063561);
  expect(d.marcas).toBeTruthy();
  const desp = d.marcas_despachos;
  expect(Array.isArray(desp) && desp.length).toBeTruthy();
  const m = Object.fromEntries(desp.map(x => [x.num_rpi, x.complemento]));
  // despacho textual com "Detalhes do despacho:" — o complemento que faltava no backlog
  expect(m['2890']).toMatch(/^Detalhes do despacho:/);
});

test('extrai complemento de despacho NUMÉRICO (estrutural, não some no dump)', () => {
  const d = doc('detail_449552.html', 449552);
  const compls = d.marcas_despachos.map(x => x.complemento).filter(Boolean);
  expect(compls.some(c => /INCISO I DO ART\. 142 DA LPI\./.test(c))).toBe(true);
});

test('campos básicos da marca presentes', () => {
  const d = doc('detail_4145.html', 4145);
  expect(d.marcas.n_url).toBe(4145);
  expect(typeof d.marcas.processo).toBe('string');
});
