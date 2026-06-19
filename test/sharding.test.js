const { dirImagem, caminhoImagem, nUrlDeCaminho } = require('../src/sharding');
const path = require('path');

test('caminhoImagem espelha a fórmula do app', () => {
  expect(caminhoImagem(449552, '/base', 'jpg')).toBe(path.join('/base', '0', '449', '449552.jpg'));
  expect(caminhoImagem(4145, '/base', 'png')).toBe(path.join('/base', '0', '4', '4145.png'));
  expect(caminhoImagem(6497967, '/base', 'gif')).toBe(path.join('/base', '6', '497', '6497967.gif'));
});

test('dirImagem retorna apenas o diretório', () => {
  expect(dirImagem(449552, '/base')).toBe(path.join('/base', '0', '449'));
});

test('nUrlDeCaminho extrai o n_url do nome do arquivo', () => {
  expect(nUrlDeCaminho('/base/0/449/449552.jpg')).toBe(449552);
  expect(nUrlDeCaminho('449552.png')).toBe(449552);
  expect(nUrlDeCaminho('/base/0/449/sem-numero.jpg')).toBeNull();
});
