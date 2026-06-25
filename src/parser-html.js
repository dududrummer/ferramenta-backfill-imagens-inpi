// worker/src/updater/html-parser.js
// Porta fiel da extração do scraper Puppeteer antigo para cheerio.
// IMPORTANTE: o html DEVE chegar já decodificado como latin1 (ISO-8859-1).
// Os divs ocultos de complemento (<div id="despacho..." VISIBILITY:hidden>) contêm
// <font class=normal> DENTRO do accordion de Publicações; a varredura por descendentes
// .normal os captura — assim como o $$('.normal') do Puppeteer fazia.
const cheerio = require('cheerio');
const { parseDoc } = require('./parser-doc');

const SEL_MAIN = '#principal > table:nth-child(6) > tbody > tr';

function parseDetailHtml(html, codPedido) {
  const $ = cheerio.load(html);

  const erroCell = $('#principal > table > tbody > tr:nth-child(4) > td').first().text().trim();
  if (erroCell === 'Erro: Pedido inexistente!') {
    return { processo: '', nUrl: codPedido, paginaCompleta: false, inexistente: true };
  }

  const num = { nUrl: codPedido };

  for (let i = 1; i <= 10; i++) {
    const label = $(`${SEL_MAIN}:nth-child(${i}) > td:nth-child(1) > font`).text().trim();
    if (!label) continue;
    const td2font = `${SEL_MAIN}:nth-child(${i}) > td:nth-child(2) > font`;
    const val = $(td2font).text().trim();
    if      (label === 'Nº do Processo:') num.processo = $(`${td2font} > b`).text().trim();
    else if (label === 'Nº da Inscrição Internacional (IRN):') num.inscInternacional = val;
    else if (label === 'Marca:')          num.marca = val || $(`${SEL_MAIN}:nth-child(${i}) > td:nth-child(2)`).text().trim();
    else if (label === 'Situação:')       num.situacao = val;
    else if (label === 'Apresentação:')   num.apresentacao = val;
    else if (label === 'Natureza:')       num.natureza = val;
    else if (label === 'Apostila :') {
      num.apostila = $('#apostila > table > tbody > tr:nth-child(2) > td > font').text().trim() || val || false;
      const caducLabel = $(`${SEL_MAIN}:nth-child(${i}) > td:nth-child(3) > font`).text().trim();
      if (caducLabel === 'Caducidade:')
        num.caducidade = $(`${SEL_MAIN}:nth-child(${i}) > td:nth-child(4) > font`).text().trim();
    }
    else if (label === 'Caducidade:')     num.caducidade = val;
  }

  const tLabel = $('#traducao > table > tbody > tr:nth-child(1) > td > table > tbody > tr > td:nth-child(1) > font').text().trim();
  if (tLabel === 'Tradução')
    num.traducaoMarca = $('#traducao > table > tbody > tr:nth-child(2) > td > font').text().trim();

  num.numRevista = $('#principal > table.fundoportal > tbody > tr > td > font > b:nth-child(3)').text().trim();
  num.paginaCompleta = !!num.numRevista;

  const scraped = [num];
  $('.accordion-item').each((_, parent) => {
    const data = {};
    for (const sel of ['.titulo', '.normal']) {
      const values = [];
      let skip = false;
      $(parent).find(sel).each((__, el) => {
        const value = $(el).text().replace(/[\t\n]/g, '').replace(/\s+/g, ' ').trim();
        if (skip)               { skip = false; return; }
        if (value === 'Leia-me') { skip = true;  return; }
        if (value) values.push(value);
      });
      if (values.length === 1)      data[sel] = values[0];
      else if (values.length > 1)   data[sel] = values;
    }
    if (Object.keys(data).length > 0) scraped.push(data);
  });

  const obj = {};
  for (const item of scraped) {
    if (item['.titulo']) obj[item['.titulo']] = item['.normal'];
    else Object.assign(obj, item);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Extração ESTRUTURAL de despachos (Publicações) por validação de célula.
// Substitui a varredura por offsets fixos (parsePublicacoes) que desalinhava
// ~32% das linhas. Aqui cada linha da tabela é lida e cada célula validada,
// garantindo que num_rpi é SEMPRE numérico e data_rpi SEMPRE uma data.
// ---------------------------------------------------------------------------

function resolveTooltip($, id) {
  if (!id) return '';
  let div = $('[id="' + String(id).replace(/"/g, '') + '"]');
  if (!div.length) {
    // os ids dos divs de complemento carregam espaços à direita
    // (ex.: id="despacho1915400       "); o showMe(...) os preserva, mas
    // a comparação por seletor pode falhar — busca por id "trimado".
    const wanted = String(id).trim();
    div = $('div[id]').filter((_, el) => ($(el).attr('id') || '').trim() === wanted).first();
  }
  if (!div.length) return '';
  return div.text().replace(/\s+/g, ' ').replace(/^\s*(Leia-me|Descri[çc][aã]o Despacho)\s*/i, '').trim();
}

function _showMeId($, row) {
  const s = $(row).find('[onmouseover]').map((_, e) => $(e).attr('onmouseover')).get().join(' ');
  const m = s.match(/showMe\(.([^)'"]+)/);
  return m ? m[1].trim() : null;
}

const _isRpi  = v => /^\d{1,4}$/.test(v);
const _isData = v => /^\d{2}\/\d{2}\/\d{4}$/.test(v);
const _isNoise = c => !c || c === '-' || /^Descri[çc][aã]o Despacho$/i.test(c) || c === 'Leia-me';
const _longest = arr => arr.filter(c => !_isNoise(c)).sort((a, b) => b.length - a.length)[0] || '';

function extractDespachos($, processo) {
  const sec = $('.accordion-item')
    .filter((_, it) => $(it).find('.titulo').first().text().includes('Publicaç'))
    .first();
  const out = [];
  sec.find('tr').each((_, tr) => {
    const cells = $(tr).find('td')
      .map((_, td) => $(td).clone().find('div[id]').remove().end().text().replace(/\s+/g, ' ').trim())
      .get();
    if (cells.length < 2 || !_isRpi(cells[0]) || !_isData(cells[1])) return;

    const num_rpi = cells[0];
    const data_rpi = cells[1];
    let codigo_despacho = '';
    let descricao_despacho = '';

    if (_isRpi(cells[2])) {
      // Despacho com código numérico: a coluna "Despacho" mostra só o número; a descrição
      // completa ("565 ANOTADA A TRANSFERENCIA.") vem do tooltip (showMe -> div) ou, como
      // fallback, da célula visível que começa com "<código> ".
      codigo_despacho = cells[2];
      descricao_despacho =
        resolveTooltip($, _showMeId($, tr)) ||
        cells.find(c => c.startsWith(codigo_despacho + ' ')) ||
        '';
    } else {
      // Despacho textual: a 3ª coluna já é a própria descrição ("Deferimento da petição").
      descricao_despacho = cells[2] || '';
    }
    descricao_despacho = descricao_despacho.replace(/^Descri[çc][aã]o Despacho\s*/i, '').trim();
    // Remove o código numérico repetido no início ("740 NAO CONHECIDA..." -> "NAO CONHECIDA...").
    if (codigo_despacho) {
      descricao_despacho = descricao_despacho.replace(new RegExp('^' + codigo_despacho + '\\s+'), '').trim();
    }

    // Complemento é SEMPRE a última coluna ("Complemento do Despacho") — texto VISÍVEL na
    // linha (não vem de tooltip). Pode ser vazio ("-" ou em branco).
    let complemento = (cells[cells.length - 1] || '').trim();
    if (complemento === '-' || complemento === descricao_despacho) complemento = '';

    out.push({ processo, num_rpi, data_rpi, codigo_despacho, descricao_despacho, complemento });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Extração ESTRUTURAL das Classificações de Produtos/Serviços por COLUNA.
// Regra (confirmada no HTML do INPI): a especificação SÓ vem da coluna
// "Especificação" / "Especificação Livre" / "Especificação Sub-Classe Nacional".
//  - Se a célula tem popup: showMe('especificacao{N}') = original (estrangeiro),
//    showMe('especificacaoTradu{N}') = tradução (português).
//  - Sem popup: dois <font class="normal"> (1º original, 2º tradução, separados por <hr>).
// NUNCA usar o popup showMe('cln{N}'), que é a descrição genérica da Classe Nice.
// Retorna especificacao (português) e especificacao_ingles (estrangeiro), separados.
// ---------------------------------------------------------------------------
function pickEspecificacao($, $cell) {
  if (!$cell || !$cell.length) return { especificacao: '', especificacao_ingles: '' };
  // IDs de popup (showMe) desta célula. A coluna de especificação aparece como "Especificação"
  // (NICE), "Especificação Livre" ou "Especificação Sub-Classe Nacional" (Nacional). O id do
  // popup varia conforme a era da página: NICE usa "especificacao{N}" / "especificacaoTradu{N}";
  // o nacional antigo usa "txtEspecificacao". Capturamos qualquer id que CONTENHA "especifica".
  // A tradução (português), quando existe, vem num id com "Tradu"; o restante é o original.
  const ids = $cell.find('[onmouseover]').map((_, e) => {
    const m = ($(e).attr('onmouseover') || '').match(/showMe\(['"]?(\w*especifica\w*)/i);
    return m ? m[1] : null;
  }).get().filter(Boolean);
  const traduId = ids.find(id => /Tradu/i.test(id));
  const origId  = ids.find(id => id !== traduId && !/Tradu/i.test(id));
  let original = '', traducao = '';
  if (origId || traduId) {
    // Remove o rótulo da coluna repetido no cabeçalho do popup
    // ("Especificação", "Especificação Livre", "Especificação Sub-Classe Nacional").
    const clean = id => resolveTooltip($, id)
      .replace(/^Especifica[çc][aã]o(\s+Livre|\s+Sub-?\s*Classe\s+Nacional)?\s*/i, '')
      .trim();
    original = origId  ? clean(origId)  : '';
    traducao = traduId ? clean(traduId) : '';
  } else {
    const fonts = $cell.find('font.normal').map((_, f) =>
      $(f).clone().find('div[id]').remove().end().text().replace(/\s+/g, ' ').trim()
    ).get().filter(Boolean);
    original = fonts[0] || '';
    traducao = fonts[1] || '';
  }
  // Havendo tradução, o original é o idioma estrangeiro (inglês) e a tradução é o português.
  if (traducao) return { especificacao: traducao, especificacao_ingles: original };
  return { especificacao: original, especificacao_ingles: '' };
}

// Revisão da classe Nice: descrição oficial da classe na edição, vinda do popup showMe('cln{N}')
// da coluna Classe (ex.: "Classe Nice - Revisão: (11) Aparelhos e instrumentos científicos...").
// Remove o rótulo "Classe Nice - Revisão: (X)"; se houver mais de uma, junta por quebra de linha.
function pickRevisao($, $classeCell) {
  if (!$classeCell || !$classeCell.length) return '';
  const ids = $classeCell.find('[onmouseover]').map((_, e) => {
    const m = ($(e).attr('onmouseover') || '').match(/showMe\(['"]?(cln\w*)/i);
    return m ? m[1] : null;
  }).get().filter(Boolean);
  const textos = ids
    .map(id => resolveTooltip($, id).replace(/^Classe Nice - Revis[ãa]o:\s*\(\d+\)\s*/i, '').trim())
    .filter(Boolean);
  return [...new Set(textos)].join('\n');
}

function extractClassificacoes($, processo) {
  const sec = $('.accordion-item')
    .filter((_, it) => {
      const t = $(it).find('.titulo').first().text();
      return /Classifica[çc]/i.test(t) && /Produtos|Servi[çc]/i.test(t);
    })
    .first();

  const out = [];
  let lastNacional = '';      // classe nacional herdada nas linhas de continuação
  let lastNacionalEsp = null; // especificação herdada quando vem por rowspan (linha só com a sub-classe)
  sec.find('tr').each((_, tr) => {
    const tdEls = $(tr).children('th,td').toArray();
    if (!tdEls.length) return;
    const cells = tdEls.map(c => $(c).clone().find('div[id]').remove().end().text().replace(/\s+/g, ' ').trim());
    const first = cells[0] || '';
    // A especificação é SEMPRE a última coluna da linha — vale p/ Nice e Nacional, inclusive
    // linhas de continuação nacionais que omitem a classe (rowspan) e trazem só sub-classe + espec.
    const $esp = $(tdEls[tdEls.length - 1]);

    const mNice = first.match(/^NCL\((\d+)\)\s+(\S+)/);
    if (mNice) {
      const edicao = mNice[1];
      const classe = mNice[2];
      const situacao = cells.find(c => /Vide Situa|Em vigor|Extint|Arquiv|Deferid|Indeferid/i.test(c)) || '';
      const { especificacao, especificacao_ingles } = pickEspecificacao($, $esp);
      const revisao = pickRevisao($, $(tdEls[0]));
      out.push({ processo, tipo: 'NICE', classe, sub_classe: '', edicao, situacao, especificacao, especificacao_ingles, revisao });
      return;
    }

    // NACIONAL: 1ª célula é um código numérico. >=3 células = linha com a classe; 2 células =
    // continuação com especificação própria (sub-classe + espec.); 1 célula = continuação onde a
    // especificação veio por rowspan da linha de cima (só a sub-classe) → herda a espec. anterior.
    if (/^\d{1,3}$/.test(first)) {
      let classe, sub_classe, esp;
      if (tdEls.length >= 3) {
        classe = cells[0]; sub_classe = cells[1]; lastNacional = classe;
        esp = pickEspecificacao($, $esp); lastNacionalEsp = esp;
      } else if (tdEls.length === 2) {
        classe = lastNacional; sub_classe = cells[0];
        esp = pickEspecificacao($, $esp); lastNacionalEsp = esp;
      } else { // 1 célula: a espec. está em rowspan na linha anterior, não nesta célula
        classe = lastNacional; sub_classe = cells[0];
        esp = lastNacionalEsp || { especificacao: '', especificacao_ingles: '' };
      }
      out.push({ processo, tipo: 'NACIONAL', classe, sub_classe, edicao: '', situacao: '', especificacao: esp.especificacao, especificacao_ingles: esp.especificacao_ingles, revisao: '' });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Extração ESTRUTURAL das Petições (com pagamentos e descrição de serviço).
// A seção é a MAIS irregular: cada petição real vive numa linha de ~17 células
// onde o texto dos tooltips ocultos VAZA para dentro das td's. Duas dicas
// confiáveis por linha vêm dos onmouseover="showMe('pgto{n}')" (info do banco)
// e showMe('{códigoServiço}')" (descrição completa do serviço). Identificamos a
// linha de petição pela presença do tooltip pgto{n} (ou por um protocolo de
// >=9 dígitos), e resolvemos os textos completos via resolveTooltip — assim
// nada se perde mesmo que o split estruturado do "Valor:" seja imperfeito.
// ---------------------------------------------------------------------------
function _parsePgto(raw) {
  const banco = (raw.match(/Informaç[õo]es do Banco:\s*([^]*?)\s*(?:Data:|Valor:|$)/i) || [])[1] || '';
  const data  = (raw.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || '';
  const valor = (raw.match(/Valor:\s*([^]*)$/i) || [])[1] || '';
  return {
    pagamento_banco: banco.trim(),
    pagamento_data: data.trim(),
    pagamento_valor: valor.trim(),
    pagamento_raw: raw.trim(),
  };
}

function extractPeticoes($, processo) {
  const sec = $('.accordion-item')
    .filter((_, it) => $(it).find('.titulo').first().text().includes('Petiç'))
    .first();
  const out = [];
  sec.find('tr').each((_, tr) => {
    const onmo = $(tr)
      .find('[onmouseover]')
      .map((_, e) => $(e).attr('onmouseover'))
      .get()
      .join(' ');

    const pgtoId = (onmo.match(/showMe\(['"]?(pgto\d+)/i) || [])[1];
    // Match 3+ digit service codes (e.g. 389 or 3023); \b was preventing 4-digit codes.
    const servId = (onmo.match(/showMe\(['"]?(\d{3,})['"]?\)/) || [])[1];

    const cells = $(tr)
      .find('td')
      .map((_, td) =>
        $(td).clone().find('div[id]').remove().end().text().replace(/\s+/g, ' ').trim()
      )
      .get();

    // Protocolo: célula puramente numérica com 9+ dígitos.
    const proto =
      cells.find(c => /^\d{9,}$/.test(c)) ||
      (cells.join(' ').match(/Protocolo:\s*(\d+)/) || [])[1] ||
      '';

    // Só consideramos linha de petição se houver protocolo OU um tooltip de pagamento.
    if (!proto && !pgtoId) return;

    // Data: primeira célula que é SÓ uma data (a string "Informações do Banco: ... Data: dd/mm/aaaa"
    // não casa, pois tem texto antes), evitando pegar a data do pagamento.
    const data = cells.find(c => /^\d{2}\/\d{2}\/\d{4}$/.test(c)) || '';
    const codigo_servico = servId || cells.find(c => /^\d{3,4}$/.test(c)) || '';

    const pgto = pgtoId
      ? _parsePgto(resolveTooltip($, pgtoId))
      : { pagamento_banco: '', pagamento_data: '', pagamento_valor: '', pagamento_raw: '' };

    // Descrição visível do serviço na própria linha (começa com o código: "374 Prorrogação...").
    const descVisivel = codigo_servico
      ? cells.find(c => c.startsWith(codigo_servico + ' ') && c.length > codigo_servico.length + 1) || ''
      : '';

    // Descrição completa: preferir o tooltip (showMe -> div), removendo só o rótulo de coluna
    // "Descrição do Serviço"; manter o código no início ("848 Cadastro de pedido antigo com GRPI").
    let descricao_servico = (
      servId
        ? resolveTooltip($, servId).replace(/^Descri[çc][aã]o do Servi[çc]o\s*/i, '').trim()
        : ''
    ) || descVisivel;
    // Remove o código numérico do início ("374 Prorrogação..." -> "Prorrogação...").
    if (codigo_servico) {
      descricao_servico = descricao_servico.replace(new RegExp('^' + codigo_servico + '\\s+'), '').trim();
    }

    // Cliente: any cell that is not a known value, not a number/date, and not tooltip noise.
    // The old approach required a corporate suffix (LTDA, S/A, etc.) which missed government
    // bodies (e.g. "DIRMA/GABINETE") and individuals. Position-exclusion is more robust.
    const _isLeak = c =>
      /Informaç[õo]es do Banco|Descri[çc][aã]o do Servi[çc]o|Banco Ita|Valor:\s*R\$/i.test(c);
    // Inclui a descrição VISÍVEL do serviço no conjunto conhecido — senão ela vaza como cliente
    // nas petições sem pagamento (onde aparece imediatamente antes do nome do cliente).
    const knownCells = new Set([proto, data, codigo_servico, descVisivel].filter(Boolean));
    const cliente = cells.find(c =>
      c &&
      c.length > 2 &&
      c !== '-' &&
      !_isLeak(c) &&
      !knownCells.has(c) &&
      !/^\d+$/.test(c) &&
      !/^\d{2}\/\d{2}\/\d{4}$/.test(c)
    ) || '';

    out.push({
      processo,
      protocolo: proto,
      data,
      codigo_servico,
      descricao_servico,
      cliente,
      info_banco: pgto.pagamento_raw,
      ...pgto,
    });
  });
  return out;
}

// Extrai as datas diretamente das células da tabela HTML (preserva células em branco),
// evitando o problema do .normal-array onde células vazias desaparecem e encavalham os campos.
// Colunas: [Depósito, Concessão, Vigência, Recebimento INPI]
function extractDatas($) {
  const sec = $('.accordion-item')
    .filter((_, it) => $(it).find('.titulo').first().text().includes('Datas'))
    .first();
  if (!sec.length) return null;

  // As células da tabela de Datas podem ser <th> OU <td> (varia entre páginas) e o valor real
  // fica em <font class="normal">. Lê cada linha preservando células vazias (a posição importa
  // p/ alinhar cabeçalho e valores), ignorando tooltips ("Leia-me") e divs ocultos.
  const readCell = c => {
    const $c = $(c).clone();
    $c.find('div[id]').remove();
    const norm = $c.find('.normal');
    const t = (norm.length ? norm.first().text() : $c.text()).replace(/\s+/g, ' ').trim();
    return /^Leia-me$/i.test(t) ? '' : t;
  };
  const rows = [];
  sec.find('tr').each((_, tr) => {
    const cells = $(tr).children('th,td').map((_, c) => readCell(c)).get();
    if (cells.some(c => c)) rows.push(cells);
  });
  if (!rows.length) return null;

  const headerRow = rows.find(r => r.some(c => /Dep[óo]s/i.test(c)));
  const valueRow  = rows.find(r => r.some(c => /^\d{2}\/\d{2}\/\d{4}$/.test(c)));
  if (!valueRow) return null;

  // Preferido: parear cabeçalho ↔ valores por NOME da coluna. Robusto a colunas extras
  // ("Data de recebimento pelo INPI") e a concessão em branco — desde que as células fiquem
  // alinhadas por posição. A checagem de formato evita capturar um rótulo como se fosse data
  // caso haja desalinhamento.
  if (headerRow) {
    // Datas mantidas no formato brasileiro cru (DD/MM/YYYY), como na página do INPI.
    const pick = re => {
      const idx = headerRow.findIndex(c => re.test(c));
      const v = idx >= 0 ? (valueRow[idx] || '') : '';
      return /^\d{2}\/\d{2}\/\d{4}$/.test(v) ? v : '';
    };
    return {
      data_deposito:    pick(/Dep[óo]s/i),
      data_concessao:   pick(/Concess/i),
      data_vigencia:    pick(/Vig[êe]nc/i),
      data_recebimento: pick(/Receb/i),
    };
  }

  // Fallback (sem cabeçalho reconhecível): assume a ordem do layout do INPI
  // (depósito, concessão, vigência, recebimento) entre as datas presentes.
  const datas = valueRow.filter(c => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
  return {
    data_deposito:    datas[0] || '',
    data_concessao:   datas[1] || '',
    data_vigencia:    datas[2] || '',
    data_recebimento: datas[3] || '',
  };
}

// Doc final no formato do batch-writer: parseDoc para marca + seções simples,
// e os extratores estruturais para despachos/classificações/petições (corrigidos/completos).
function parseDetailFull(html, codPedido) {
  const $ = cheerio.load(html);
  const flat = parseDetailHtml(html, codPedido);
  const base = parseDoc({ ...flat, _id: '' });
  const processo = base.marcas.processo;

  // Override dates with position-aware extraction (blank cells preserved as empty string)
  const datas = extractDatas($);
  if (datas) Object.assign(base.marcas, datas);

  base.marcas_despachos      = extractDespachos($, processo);
  base.marcas_classificacoes = extractClassificacoes($, processo);
  base.marcas_peticoes       = extractPeticoes($, processo);
  base.marcas.inscricao_internacional = String(flat.inscInternacional || '');
  base.marcas.dados_brutos            = JSON.stringify(flat);

  // Imagem da marca: presente só quando a página traz a tag do servlet de logo
  // (todas as apresentações exceto nominativa pura). Detecção por presença da tag, não por tipo.
  const temImagem = /LogoMarcasServletController/.test(html);
  base.temImagem = temImagem;
  base.marcas.tem_imagem = temImagem ? 1 : 0;

  return base;
}

// Uma página é VÁLIDA p/ gravar quando tem CONTEÚDO real de marca — mesmo SEM número de processo.
// Algumas marcas (ex.: registros de ALTO RENOME, como BATAVO/CASAS BAHIA) têm página completa mas
// NÃO trazem "Nº do Processo:". Antes essas páginas eram descartadas como "dados_vazios", virando
// FALSO BURACO (marcadas como sem-dados) e/ou re-raspagem infinita (a query de pendências as trazia
// para sempre). Sinais robustos de página real (a página já passou pelo classifyHtml: tem
// accordion-item e não é "Pedido inexistente"): tem processo, OU é página completa (num_revista no
// cabeçalho), OU traz o nome da marca. Sem NENHUM desses → página nula/garbage → descarta.
function isPaginaValida(doc) {
  if (!doc || !doc.marcas) return false;
  const m = doc.marcas;
  return !!(String(m.processo || '').trim() || m.pagina_completa || String(m.marca || '').trim());
}

module.exports = { parseDetailHtml, resolveTooltip, extractDatas, extractDespachos, extractClassificacoes, extractPeticoes, parseDetailFull, isPaginaValida };
