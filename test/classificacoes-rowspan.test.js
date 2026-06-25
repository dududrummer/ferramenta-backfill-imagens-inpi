const cheerio = require('cheerio');
const { extractClassificacoes } = require('../src/parser-html');

// Espelha o teste do worker: estrutura real do INPI (n_url 1105060). A "Especificação Livre" tem
// rowspan sobre as 2 sub-classes (10 e 20); a linha da sub-classe 20 traz SÓ a sub-classe e a
// especificação vem por rowspan da linha de cima. Antes o parser pegava o nº "20" como espec.
const HTML = `
<div class="accordion-item">
  <font class="titulo">Classificação de Produtos/Serviços</font>
  <table>
    <thead><tr>
      <th><font class="normal">Classe Nacional</font></th>
      <th><font class="normal">Sub-Classe Nacional</font></th>
      <th><font class="normal">Especificação Livre</font></th>
    </tr></thead>
    <tbody>
      <tr>
        <td rowspan="2"><font class="normal">16</font></td>
        <td><font class="normal">10</font></td>
        <td rowspan="2"><font class="normal">PAPEL E PAPELÃO, PAPÉIS DE CARTA, ÁLBUNS DE FOTOGRAFIA.</font></td>
      </tr>
      <tr>
        <td><font class="normal">20</font></td>
      </tr>
    </tbody>
  </table>
</div>`;

test('NACIONAL com Especificação em rowspan: a sub-classe de continuação herda a especificação (não o nº dela)', () => {
  const out = extractClassificacoes(cheerio.load(HTML), 'P');
  expect(out.length).toBe(2);
  expect(out[0]).toMatchObject({ classe: '16', sub_classe: '10', especificacao: 'PAPEL E PAPELÃO, PAPÉIS DE CARTA, ÁLBUNS DE FOTOGRAFIA.' });
  expect(out[1]).toMatchObject({ classe: '16', sub_classe: '20', especificacao: 'PAPEL E PAPELÃO, PAPÉIS DE CARTA, ÁLBUNS DE FOTOGRAFIA.' });
});
