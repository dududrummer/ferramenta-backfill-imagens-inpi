const { detectarExt, ehImagemValida, ehPlaceholder } = require('../src/image-detect');
const crypto = require('crypto');

const jpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const bmp = Buffer.from([0x42, 0x4D, 0x00, 0x00]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0,0,0,0]), Buffer.from('WEBP')]);
const html = Buffer.from('<html><body>erro</body></html>');

test('detectarExt reconhece os formatos suportados', () => {
  expect(detectarExt(jpg)).toBe('jpg');
  expect(detectarExt(png)).toBe('png');
  expect(detectarExt(gif)).toBe('gif');
  expect(detectarExt(bmp)).toBe('bmp');
  expect(detectarExt(webp)).toBe('webp');
});

test('detectarExt retorna null para não-imagem', () => {
  expect(detectarExt(html)).toBeNull();
  expect(detectarExt(Buffer.alloc(0))).toBeNull();
});

test('ehImagemValida é true só quando há extensão detectada', () => {
  expect(ehImagemValida(jpg)).toBe(true);
  expect(ehImagemValida(html)).toBe(false);
});

test('ehPlaceholder compara o sha1 com o conjunto conhecido', () => {
  const hash = crypto.createHash('sha1').update(jpg).digest('hex');
  expect(ehPlaceholder(jpg, [hash])).toBe(true);
  expect(ehPlaceholder(jpg, [])).toBe(false);
  expect(ehPlaceholder(png, [hash])).toBe(false);
});
