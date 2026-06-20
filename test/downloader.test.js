const { classificarResultado, baixarBuffer } = require('../src/downloader');

const jpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
const html = Buffer.from('<html>nao tem</html>');

test('classificarResultado: imagem válida → baixada com ext', () => {
  const r = classificarResultado({ status: 200, buffer: jpg }, []);
  expect(r).toMatchObject({ resultado: 'baixada', ext: 'jpg' });
});

test('classificarResultado: 200 mas não-imagem → sem_imagem', () => {
  expect(classificarResultado({ status: 200, buffer: html }, []).resultado).toBe('sem_imagem');
});

test('classificarResultado: buffer vazio → sem_imagem', () => {
  expect(classificarResultado({ status: 200, buffer: Buffer.alloc(0) }, []).resultado).toBe('sem_imagem');
});

test('classificarResultado: placeholder conhecido → sem_imagem', () => {
  const crypto = require('crypto');
  const h = crypto.createHash('sha1').update(jpg).digest('hex');
  expect(classificarResultado({ status: 200, buffer: jpg }, [h]).resultado).toBe('sem_imagem');
});

test('classificarResultado: 403/timeout → bloqueio', () => {
  expect(classificarResultado({ status: 403, buffer: null }, []).resultado).toBe('bloqueio');
  expect(classificarResultado({ status: 0, erro: 'timeout' }, []).resultado).toBe('bloqueio');
});

test('classificarResultado: 5xx → erro', () => {
  expect(classificarResultado({ status: 500, buffer: null }, []).resultado).toBe('erro');
});

test('baixarBuffer usa o injetor de http e monta o path correto', async () => {
  let pathChamado = null;
  const fakeHttp = async ({ path }) => { pathChamado = path; return { status: 200, buffer: jpg }; };
  const r = await baixarBuffer({ agent: {} }, 449552, { _httpGet: fakeHttp, timeoutMs: 1000 });
  expect(pathChamado).toContain('codProcesso=449552');
  expect(r.buffer).toBe(jpg);
});

test('classificarResultado: 302 (sem sessão) → sessao', () => {
  expect(classificarResultado({ status: 302, buffer: null }, []).resultado).toBe('sessao');
});
