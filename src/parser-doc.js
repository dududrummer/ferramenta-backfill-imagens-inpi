function normalizeDate(val) {
  if (!val || typeof val !== 'string') return '';
  const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return val;
}

function parseDatas(arr) {
  if (!Array.isArray(arr)) return { data_deposito: '', data_concessao: '', data_vigencia: '', data_recebimento: '' };

  // Headers and tooltip texts (from the `?` icons) precede the actual date values.
  // The original slice(3) assumed 3 plain headers, but the table now has 4 columns and
  // the last two have tooltip divs injecting extra .normal elements before the dates.
  // Blank cells (e.g. empty Concessão) are absent from the array entirely.
  // Strategy: find the first DD/MM/YYYY value, collect all dates, then assign by
  // chronological heuristic: deposito=earliest, vigencia=latest, concessao=middle if >1yr from deposito.
  const firstDateIdx = arr.findIndex(v => v && /^\d{2}\/\d{2}\/\d{4}$/.test(v));
  if (firstDateIdx < 0) return { data_deposito: '', data_concessao: '', data_vigencia: '', data_recebimento: '' };

  const dates = arr.slice(firstDateIdx).filter(v => v && /^\d{2}\/\d{2}\/\d{4}$/.test(v));
  if (dates.length === 0) return { data_deposito: '', data_concessao: '', data_vigencia: '', data_recebimento: '' };

  const toMs = s => { const [d, m, y] = s.split('/'); return Date.UTC(+y, +m - 1, +d); };
  const sorted = [...dates].sort((a, b) => toMs(a) - toMs(b));

  const data_deposito = sorted[0];
  const data_vigencia  = sorted.length > 1 ? sorted[sorted.length - 1] : '';

  // Concessão is years after depósito (trademark takes years to be granted);
  // "Data de recebimento pelo INPI" is within months of depósito — not concessão.
  const ONE_YEAR = 365.25 * 24 * 3600 * 1000;
  const depMs    = toMs(sorted[0]);
  const midDates = sorted.slice(1, sorted.length - 1);
  const conc     = midDates.find(d => toMs(d) - depMs > ONE_YEAR);
  const data_concessao = conc || '';

  // data_recebimento não é inferível por heurística cronológica (fica a meses do depósito,
  // como a concessão pode ficar). No fluxo de scraping, extractDatas a captura por nome de
  // coluna e sobrescreve este valor; no clone legado do Mongo fica vazia.
  return { data_deposito, data_concessao, data_vigencia, data_recebimento: '' };
}

function parsePessoasArray(arr) {
  if (!Array.isArray(arr)) return [];
  const result = [];
  let i = 0;
  while (i < arr.length) {
    if (arr[i] === 'Nome') {
      const tipo = arr[i + 1] || '';
      const nome = arr[i + 2] || '';
      result.push({ tipo, nome });
      i += 3;
    } else {
      i++;
    }
  }
  return result;
}

function parseTitulares(arr)      { return parsePessoasArray(arr); }
function parseRepresentantes(arr) { return parsePessoasArray(arr); }

function parsePublicacoes(arr) {
  if (!Array.isArray(arr)) return [];
  const HEADERS = 6;
  const result = [];
  let i = HEADERS;
  while (i < arr.length) {
    const num_rpi  = arr[i]     || '';
    const data_rpi = arr[i + 1] || '';
    const third    = arr[i + 2] || '';

    if (/^\d+$/.test(third)) {
      const codigo_despacho    = third;
      const descricao_despacho = arr[i + 5] || '';
      let complemento = '';
      const maybeCmp = arr[i + 8];
      if (maybeCmp !== undefined && maybeCmp !== '-' && !/^\d{4}$/.test(maybeCmp)) {
        complemento = maybeCmp;
        i += 9;
      } else {
        i += 8;
      }
      result.push({ num_rpi, data_rpi, codigo_despacho, descricao_despacho, complemento });
    } else {
      const descricao_despacho = third;
      i += 5;
      result.push({ num_rpi, data_rpi, codigo_despacho: '', descricao_despacho, complemento: '' });
    }
  }
  return result;
}

function parseClassificacoes(arr) {
  if (!Array.isArray(arr)) return [];
  const result = [];

  if (arr[0] === 'Classe Nacional') {
    let i = 3;
    while (i + 2 < arr.length) {
      result.push({
        tipo:          'NACIONAL',
        classe:        arr[i]     || '',
        sub_classe:    arr[i + 1] || '',
        edicao:        '',
        especificacao: arr[i + 2] || '',
      });
      i += 3;
    }
  } else if (arr[0] === 'Classe de Nice') {
    let i = 3;
    while (i < arr.length) {
      const classeRaw = arr[i] || '';
      if (!classeRaw.startsWith('NCL(')) { i++; continue; }
      const match = classeRaw.match(/NCL\((\d+)\)\s+(\S+)/);
      const edicao = match ? match[1] : '';
      const classe = match ? match[2] : classeRaw;
      let specs = [];
      // skip duplicate header at i+1 if it is the same NCL entry
      let j = i + 1;
      if (j < arr.length && (arr[j] || '').startsWith('NCL(') && arr[j] === classeRaw) j++;
      while (j < arr.length && !(arr[j] || '').startsWith('NCL(')) {
        const v = arr[j] || '';
        if (v && v !== 'Vide Situação do Processo' && v !== 'Vide' && !v.startsWith('Classe Nice')) specs.push(v);
        j++;
      }
      const especificacao = specs.sort((a, b) => b.length - a.length)[0] || '';
      result.push({ tipo: 'NICE', classe, sub_classe: '', edicao, especificacao });
      i = j;
    }
  }

  return result;
}

function parseViena(arr) {
  if (!Array.isArray(arr)) return [];
  const result = [];
  let i = 3;
  while (i + 2 < arr.length) {
    result.push({ edicao: arr[i] || '', codigo: arr[i + 1] || '', descricao: arr[i + 2] || '' });
    i += 3;
  }
  return result;
}

function parsePrioridade(arr) {
  if (!Array.isArray(arr)) return [];
  try {
    const result = [];
    let i = 0;
    while (i < arr.length && !/\d/.test(arr[i])) { i++; }
    while (i + 2 < arr.length) {
      result.push({ pais: arr[i] || '', numero: arr[i + 1] || '', data: arr[i + 2] || '', dados_raw: '' });
      i += 3;
    }
    return result.length > 0 ? result : [{ pais: '', numero: '', data: '', dados_raw: JSON.stringify(arr) }];
  } catch {
    return [{ pais: '', numero: '', data: '', dados_raw: JSON.stringify(arr) }];
  }
}

function parsePrazos(arr) {
  if (!Array.isArray(arr)) return [];
  return [
    { tipo_prazo: 'Ordinário',      data_inicio: arr[3] || '', data_fim: arr[6] || '' },
    { tipo_prazo: 'Extraordinário', data_inicio: arr[4] || '', data_fim: arr[7] || '' },
  ];
}

function parsePeticoes(arr) {
  if (!Array.isArray(arr)) return [];
  const HEADERS = 8;
  const result  = [];

  // The original fixed stride=12 was wrong: paid rows add bank-info tooltip elements,
  // unpaid rows don't, and service-code tooltips also vary — so stride is variable.
  // Anchor on PROTOCOLO (9+ digit number) which always exists and is unambiguous.
  for (let i = HEADERS; i < arr.length; i++) {
    const v = (arr[i] || '').trim();
    if (!/^\d{9,}$/.test(v)) continue;

    const protocolo = v;

    // Bank info is 1-3 positions before the protocolo (from the pgto tooltip div)
    const before = arr.slice(Math.max(HEADERS, i - 3), i);
    const info_banco = before.find(w =>
      typeof w === 'string' && (w.includes('Informaç') || w.includes('Banco') || w.includes('Valor:'))
    ) || '';

    // Data, service code, description, and client appear after the protocolo
    const after = arr.slice(i + 1, i + 12);
    const data           = after.find(w => w && /^\d{2}\/\d{2}\/\d{4}$/.test(w)) || '';
    const codigo_servico = after.find(w => w && /^\d{3,4}$/.test(w)) || '';

    // Service description: prefer entry that starts with the numeric code (e.g. "372 Primeiro décênio.").
    // Fallback to any entry starting with 3-4 digits + space.
    // "Descrição do Serviço" is the column header — do NOT pick it as the description.
    const descricao_servico =
      (codigo_servico
        ? after.find(w => w && w.length > codigo_servico.length + 2 && w.startsWith(codigo_servico + ' '))
        : null) ||
      after.find(w => w && w.length > 10 && /^\d{3,4}\s/.test(w) && !/^\d{2}\/\d{2}\/\d{4}$/.test(w)) ||
      '';

    // Cliente: any remaining text cell that is not a known value, number, or date
    const known  = new Set([protocolo, data, codigo_servico, descricao_servico, info_banco].filter(Boolean));
    const cliente = after.find(w =>
      w && w.length > 2 && w !== '-' &&
      !known.has(w) &&
      !/^\d+$/.test(w) &&
      !/^\d{2}\/\d{2}\/\d{4}$/.test(w) &&
      !/Informaç|Banco|Valor:|Descri/i.test(w)
    ) || '';

    result.push({ protocolo, data, codigo_servico, descricao_servico, cliente, info_banco });
  }
  return result;
}

function getClassificacao(doc) {
  return doc['Classificação de Produtos/Serviços']
      || doc['Classificação de Produtos / Serviços']
      || undefined;
}

function parseDoc(doc) {
  const processo = String(doc.processo || '');
  const datas    = parseDatas(doc.Datas);

  const marcas = {
    processo,
    marca:           String(doc.marca          || ''),
    situacao:        String(doc.situacao        || ''),
    apresentacao:    String(doc.apresentacao    || ''),
    natureza:        String(doc.natureza        || ''),
    num_revista:     String(doc.numRevista      || ''),
    n_url:           Number(doc.nUrl            || 0),
    pagina_completa: doc.paginaCompleta ? 1 : 0,
    data_deposito:    datas.data_deposito,
    data_concessao:   datas.data_concessao,
    data_vigencia:    datas.data_vigencia,
    data_recebimento: datas.data_recebimento || '',
    apostila:        String(doc.apostila        || ''),
    traducao_marca:  String(doc.traducaoMarca   || ''),
    caducidade:      doc.caducidade != null ? String(doc.caducidade) : '',
    id_mongo:        String(doc._id),
  };

  return {
    marcas,
    marcas_titulares:      parseTitulares(doc.Titulares).map(r => ({ processo, ...r })),
    marcas_representantes: parseRepresentantes(doc['Representante Legal']).map(r => ({ processo, ...r })),
    marcas_despachos:      parsePublicacoes(doc['Publicações']).map(r => ({ processo, ...r })),
    marcas_classificacoes: parseClassificacoes(getClassificacao(doc)).map(r => ({ processo, ...r })),
    marcas_viena:          parseViena(doc['Classificação Internacional de Viena']).map(r => ({ processo, ...r })),
    marcas_prioridades:    parsePrioridade(doc['Prioridade Unionista']).map(r => ({ processo, ...r })),
    marcas_prazos:         parsePrazos(doc['Prazos para prorrogação de registro de marca']).map(r => ({ processo, ...r })),
    marcas_peticoes:       parsePeticoes(doc['Petições']).map(r => ({ processo, ...r })),
  };
}

module.exports = {
  normalizeDate,
  parseDatas, parseTitulares, parseRepresentantes, parsePublicacoes,
  parseClassificacoes, parseViena, parsePrioridade, parsePrazos,
  parsePeticoes, parseDoc,
};
