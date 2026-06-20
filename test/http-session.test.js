const { CookieJar, isSessionExpired, warmSession } = require('../src/http-session');

test('CookieJar guarda e serializa cookies', () => {
  const jar = new CookieJar();
  jar.setFromHeaders(['JSESSIONID=abc; Path=/; HttpOnly', 'foo=bar; Path=/']);
  expect(jar.cookies.JSESSIONID).toBe('abc');
  expect(jar.cookies.foo).toBe('bar');
  expect(jar.header()).toContain('JSESSIONID=abc');
  expect(jar.header()).toContain('foo=bar');
});

test('isSessionExpired detecta 302 e página de login', () => {
  expect(isSessionExpired(302, '')).toBe(true);
  expect(isSessionExpired(200, '<input name="T_Login">')).toBe(true);
  expect(isSessionExpired(200, '<html>ok</html>')).toBe(false);
});

test('warmSession faz 4 requisições e marca warm conforme a última resposta', async () => {
  const chamadas = [];
  const fakeReq = async (agent, opts) => { chamadas.push(opts.path); return { status: 200, html: '<html>ok</html>' }; };
  const circ = { agent: {}, jar: new CookieJar(), warm: false };
  const ok = await warmSession(circ, 1000, fakeReq);
  expect(chamadas).toEqual(['/', '/servlet/LoginController', '/jsp/marcas/Pesquisa_num_processo.jsp', '/servlet/MarcasServletController']);
  expect(ok).toBe(true);
  expect(circ.warm).toBe(true);
});

test('warmSession marca warm=false se a última resposta for 302', async () => {
  const fakeReq = async () => ({ status: 302, html: '' });
  const circ = { agent: {}, jar: new CookieJar(), warm: false };
  const ok = await warmSession(circ, 1000, fakeReq);
  expect(ok).toBe(false);
  expect(circ.warm).toBe(false);
});
