// ============================================================================
//  Netlify Function: /.netlify/functions/liga
//  ---------------------------------------------------------------------------
//  Consulta o preco de uma carta na LigaPokemon (mercado brasileiro, em reais).
//
//  A LigaPokemon nao tem API publica, entao esta funcao le a pagina de busca
//  deles. Precisa rodar no servidor: o navegador bloquearia por CORS.
//
//  A busca deles responde de DUAS formas diferentes:
//    1) Quando a consulta casa com uma carta so -> devolve a PAGINA DO CARD,
//       que embute um JSON `cards_editions` com os precos ja prontos.
//       Esse e o caminho bom: dado estruturado, nao depende de layout.
//    2) Quando casa com varias -> devolve a LISTA de resultados em HTML,
//       com blocos price-min / price-avg / price-max.
//
//  Chamada:
//    /.netlify/functions/liga?nome=Pikachu&num=25&total=165
//    /.netlify/functions/liga?nome=Charizard
// ============================================================================

const BASE = 'https://www.ligapokemon.com.br/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const CACHE = new Map();
const TTL_MS = 15 * 60 * 1000;
const MAX_CACHE = 300;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

// --- utilidades -------------------------------------------------------------

function num0(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "3.500,00" -> 3500
function precoBR(txt) {
  if (!txt) return null;
  return num0(String(txt).replace(/\./g, '').replace(',', '.'));
}

// A Liga escreve o numero sempre com 3 digitos: 25 -> "025"
function pad3(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return /^\d+$/.test(s) ? s.padStart(3, '0') : s.toUpperCase();
}

const ENTIDADES = {
  '&amp;': '&', '&#39;': "'", '&apos;': "'", '&quot;': '"', '&nbsp;': ' ',
  '&aacute;': 'a', '&eacute;': 'e', '&iacute;': 'i', '&oacute;': 'o',
  '&uacute;': 'u', '&atilde;': 'a', '&otilde;': 'o', '&ccedil;': 'c',
  '&ecirc;': 'e', '&acirc;': 'a', '&ocirc;': 'o', '&ndash;': '-',
};

function limpar(bruto) {
  let s = String(bruto == null ? '' : bruto).replace(/\+/g, ' ');
  try { s = decodeURIComponent(s); } catch (e) { /* % solto: segue como esta */ }
  return s.replace(/&[a-z#0-9]+;/gi, function (e) {
    const v = ENTIDADES[e.toLowerCase()];
    return v === undefined ? e : v;
  }).trim();
}

// "Charizard ex (125/197)" -> { nome, num, total }
function separarNumero(nomeCompleto) {
  const m = String(nomeCompleto).match(/^(.*?)\s*\(([^/)]+)\/([^)]+)\)\s*$/);
  if (!m) return { nome: String(nomeCompleto), num: '', total: '' };
  return { nome: m[1].trim(), num: m[2].trim(), total: m[3].trim() };
}

function urlCard(nomeCompleto, ed, n) {
  return BASE + '?view=cards/card&card=' + encodeURIComponent(nomeCompleto) +
    '&ed=' + encodeURIComponent(ed) + '&num=' + encodeURIComponent(n);
}

async function baixar(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error('LigaPokemon respondeu ' + resp.status);
  return resp.text();
}

// --- caminho 1: pagina do card (JSON embutido) ------------------------------

function parseCardPage(html, numPedido) {
  const m = html.match(/var\s+cards_editions\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) return null;

  let edicoes;
  try { edicoes = JSON.parse(m[1]); } catch (e) { return null; }
  if (!Array.isArray(edicoes) || !edicoes.length) return null;

  const t = html.match(/<title>([^<]*)<\/title>/i);
  const tituloBruto = t ? limpar(t[1].split('|')[0]) : '';
  const partes = separarNumero(tituloBruto);

  return edicoes.map(function (e) {
    // price["0"] e o consolidado: p = menor, m = medio, g = maior.
    const precos = e.price || {};
    const p = precos['0'] || Object.values(precos)[0] || {};
    const num = String(e.num == null ? (numPedido || '') : e.num);
    return {
      nome: partes.nome || tituloBruto,
      nomeCompleto: tituloBruto,
      edicao: e.code || '',
      edicaoNome: e.name || '',
      num: num,
      total: partes.total || '',
      raridade: e.rarid ? e.rarid.label : '',
      artista: e.artist || '',
      imagem: e.img ? (e.img.indexOf('//') === 0 ? 'https:' + e.img : e.img) : '',
      precoMin: num0(p.p),
      precoMed: num0(p.m),
      precoMax: num0(p.g),
      moeda: 'BRL',
      url: urlCard(tituloBruto, e.code || '', num),
    };
  });
}

// --- caminho 2: lista de resultados (HTML) ----------------------------------

const RE_BLOCO =
  /href="\/\?view=cards\/card&card=([^"]+?)&ed=([^&"]+)&num=([^&"]+)"([\s\S]*?)(?=href="\/\?view=cards\/card|$)/g;

function parseLista(html) {
  const achados = new Map();
  let m;
  RE_BLOCO.lastIndex = 0;

  while ((m = RE_BLOCO.exec(html)) !== null) {
    const nomeCompleto = limpar(m[1]);
    const ed = limpar(m[2]);
    const bloco = m[4];
    const chave = nomeCompleto + '|' + ed;

    // Cada card aparece 2x (imagem + texto); so um dos blocos tem preco.
    const anterior = achados.get(chave);
    if (anterior && anterior.precoMin != null) continue;

    const partes = separarNumero(nomeCompleto);
    const gMin = bloco.match(/price-min">R\$\s*([\d.]+,\d{2})/);
    const gMed = bloco.match(/price-avg">R\$\s*([\d.]+,\d{2})/);
    const gMax = bloco.match(/price-max">R\$\s*([\d.]+,\d{2})/);

    achados.set(chave, {
      nome: partes.nome,
      nomeCompleto: nomeCompleto,
      edicao: ed,
      edicaoNome: '',
      num: partes.num,
      total: partes.total,
      raridade: '',
      artista: '',
      imagem: '',
      precoMin: gMin ? precoBR(gMin[1]) : null,
      precoMed: gMed ? precoBR(gMed[1]) : null,
      precoMax: gMax ? precoBR(gMax[1]) : null,
      moeda: 'BRL',
      url: urlCard(nomeCompleto, ed, m[3]),
    });
  }
  return Array.from(achados.values());
}

// --- handler ----------------------------------------------------------------

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  const url = new URL(req.url);
  const nome = (url.searchParams.get('nome') || '').trim();
  const num = (url.searchParams.get('num') || '').trim();
  const total = (url.searchParams.get('total') || '').trim();

  if (!nome) {
    return new Response(JSON.stringify({ erro: 'Faltou o parametro "nome".', resultados: [] }),
      { status: 400, headers: CORS });
  }

  // Com o numero, a busca vira quase exata: "Pikachu (025/165)"
  const consulta = (num && total) ? nome + ' (' + pad3(num) + '/' + pad3(total) + ')' : nome;
  const chave = consulta.toLowerCase();

  const guardado = CACHE.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) {
    return new Response(JSON.stringify(Object.assign({}, guardado.dados, { cache: true })),
      { status: 200, headers: Object.assign({}, CORS, { 'Cache-Control': 'public, max-age=300' }) });
  }

  const alvo = BASE + '?view=cards/search&card=' + encodeURIComponent(consulta);

  try {
    const html = await baixar(alvo);

    let resultados;
    let via;

    const doCard = parseCardPage(html, num);
    if (doCard) {
      via = 'pagina-do-card';
      resultados = doCard;
    } else {
      via = 'lista';
      resultados = parseLista(html);

      if (num && total) {
        const aNum = pad3(num);
        const aTot = pad3(total);
        const exatos = resultados.filter(function (r) {
          return pad3(r.num) === aNum && pad3(r.total) === aTot;
        });

        if (exatos.length) {
          // Varios cards diferentes podem ter o mesmo numero. Prefere o nome pedido.
          const alvoNome = nome.toLowerCase();
          const porNome = exatos.filter(function (r) {
            return r.nome.toLowerCase().indexOf(alvoNome) !== -1;
          });
          resultados = porNome.length ? porNome : exatos;

          // Busca os precos estruturados na pagina do card do melhor resultado.
          try {
            const detalhe = parseCardPage(await baixar(resultados[0].url), resultados[0].num);
            if (detalhe && detalhe.length) {
              let bom = detalhe.find(function (d) { return pad3(d.num) === aNum; });
              if (!bom) bom = detalhe[0];
              resultados[0] = Object.assign({}, resultados[0], bom, { total: resultados[0].total });
              via = 'lista+card';
            }
          } catch (e) { /* o preco da lista ja serve */ }
        }
      }
    }

    resultados.sort(function (a, b) {
      return (a.precoMin == null ? 1 : 0) - (b.precoMin == null ? 1 : 0);
    });

    const dados = {
      fonte: 'ligapokemon',
      consulta: consulta,
      via: via,
      urlBusca: alvo,
      resultados: resultados.slice(0, 20),
    };

    CACHE.set(chave, { em: Date.now(), dados: dados });
    if (CACHE.size > MAX_CACHE) CACHE.delete(CACHE.keys().next().value);

    return new Response(JSON.stringify(dados),
      { status: 200, headers: Object.assign({}, CORS, { 'Cache-Control': 'public, max-age=300' }) });
  } catch (e) {
    return new Response(JSON.stringify({ erro: String(e && e.message ? e.message : e), resultados: [] }),
      { status: 502, headers: CORS });
  }
};
