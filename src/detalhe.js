// Busca a página de DETALHE de um n_url (CodPedido) pela sessão pePI aquecida do circuito e
// classifica como o worker. Espelha http-fetcher.classifyHtml do app principal.
const { httpRequest, isSessionExpired } = require('./http-session');

async function buscarDetalhe(circ, nUrl, timeoutMs = 30000) {
  let r;
  try {
    r = await httpRequest(circ.agent, {
      method: 'GET',
      path:   `/servlet/MarcasServletController?Action=detail&CodPedido=${nUrl}`,
      jar:    circ.jar,
      timeoutMs,
    });
  } catch (e) {
    return { resultado: 'erro', erro: e.message };
  }
  const html = r.html || '';
  if (isSessionExpired(r.status, html)) return { resultado: 'sessao' };
  // Indisponibilidade do INPI (Informix/servlet) — só quando NÃO é página de detalhe válida.
  if (/inacess|java\.sql|systables/i.test(html) && !/accordion-item/.test(html)) return { resultado: 'bloqueio' };
  if (/Erro: Pedido inexistente!/.test(html)) return { resultado: 'inexistente' };
  if (!/accordion-item/.test(html)) return { resultado: 'sem_dados' };
  return { resultado: 'ok', html };
}

module.exports = { buscarDetalhe };
