#!/usr/bin/env node
// Helper Node do turbo.py: recebe um LOTE de HTMLs de detalhe já buscados (pelo Python, via Tor),
// parseia com o MESMO parseDetailFull do sistema e grava em *_rerasp via o MESMO ch-stage. Assim a
// saída no banco é IDÊNTICA à da carga manual — o Python só faz o fetch. (Decisão de paridade.)
//
// Uso:  node turbo/parse_insert.js <dir_do_lote>
//   <dir_do_lote> contém arquivos <n_url>.html (latin1, só páginas 'ok').
//   stdout (última linha): {"ok":[n_urls inseridos],"fail":[n_urls com erro de parse]}
//   Sai 0 se inseriu (ou nada a inserir); sai !=0 se o INSERT (SSH/CH) falhou → Python re-tenta.
//
// Rode com cwd = raiz da ferramenta (onde está o .env), pois o config.js usa dotenv do cwd.

// O ch-stage usa carregarConfig, que (BACKEND=tor) exige TOR_SOCKS_PORTS. O helper só INSERE,
// não busca — então satisfazemos a validação com portas dummy (ignoradas aqui).
process.env.TOR_SOCKS_PORTS = process.env.TOR_SOCKS_PORTS || '9050';
process.env.TOR_CONTROL_PORTS = process.env.TOR_CONTROL_PORTS || '9051';

const fs = require('fs');
const path = require('path');
const { carregarConfig } = require('../src/config');
const { parseDetailFull } = require('../src/parser-html');
const { criarStager } = require('../src/ch-stage');

(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error('uso: node turbo/parse_insert.js <dir_do_lote>'); process.exit(2); }

  const cfg = carregarConfig();
  const stager = criarStager(cfg);
  const ok = [], fail = [];

  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.html'))) {
    const nUrl = parseInt(path.basename(f, '.html'), 10);
    if (!Number.isInteger(nUrl)) { continue; }
    let parsed;
    try {
      const html = fs.readFileSync(path.join(dir, f), 'latin1');
      parsed = parseDetailFull(html, nUrl);
    } catch (_) { fail.push(nUrl); continue; }
    if (!parsed || !parsed.marcas) { fail.push(nUrl); continue; }   // sem marca = página inválida
    stager.add(parsed);
    ok.push(nUrl);
  }

  try {
    await stager.flush();
  } catch (e) {
    // INSERT falhou (SSH/CH): NADA foi gravado neste lote → Python re-tenta o lote depois.
    console.error('flush falhou: ' + (e && e.message || e));
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({ ok, fail }) + '\n');
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
