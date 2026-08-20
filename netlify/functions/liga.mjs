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

// Cabecalhos de navegador de verdade. Um pedido "pelado" (so User-Agent) leva
// 403 com facilidade em site protegido.
async function baixar(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error('LigaPokemon respondeu ' + resp.status);
  return resp.text();
}

// --- caminho 1: pagina do card (JSON embutido) ------------------------------

// Estado de conservacao, na numeracao da propria Liga.
const QUALIDADES = { 1: 'M', 2: 'NM', 3: 'SP', 4: 'MP', 5: 'HP', 6: 'D' };

// Versoes da carta ("extras"), na numeracao da Liga. Todos os ids sao NUMEROS
// PRIMOS, e a versao de um anuncio e o PRODUTO deles — 574 = 2x7x41 quer dizer
// Foil + Promo + Shattered Holo. Isso permite decodificar qualquer combinacao
// fatorando o numero. A pagina traz essa tabela; esta copia e so a reserva.
const EXTRAS_PADRAO = [
  { id: 2, label: 'Foil' }, { id: 3, label: 'Reverse Foil' }, { id: 5, label: 'Edition One' },
  { id: 7, label: 'Promo' }, { id: 11, label: 'Assinada' }, { id: 13, label: 'Pre Release' },
  { id: 17, label: 'Alterada' }, { id: 19, label: 'Staff' }, { id: 23, label: 'Textless' },
  { id: 29, label: 'Oversize' }, { id: 31, label: 'Shadowless' }, { id: 37, label: 'Misprint' },
  { id: 41, label: 'Shattered Holo' }, { id: 43, label: 'Master Ball' }, { id: 47, label: 'Pokeball Foil' },
];

function lerExtras(html) {
  const m = html.match(/Extras\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) return EXTRAS_PADRAO;
  try {
    const arr = JSON.parse(m[1]);
    return Array.isArray(arr) && arr.length ? arr : EXTRAS_PADRAO;
  } catch (e) {
    return EXTRAS_PADRAO;
  }
}

// 0 -> "Normal"; 2 -> "Foil"; 574 -> "Foil + Promo + Shattered Holo".
function nomeDaVersao(chave, extras) {
  let n = Number(chave);
  if (!Number.isFinite(n) || n <= 0) return 'Normal';

  const partes = [];
  extras.forEach(function (e) {
    while (n % e.id === 0) {
      partes.push(e.label);
      n = n / e.id;
    }
  });

  if (n !== 1) partes.push('versão ' + chave); // apareceu um id que nao conhecemos
  return partes.length ? partes.join(' + ') : 'Normal';
}

// Quantos anuncios existem de cada estado.
//
// O PRECO de cada anuncio nao da para ler: eles publicam como imagem (cada
// digito e um pedaco de um JPEG, via background-position no CSS), de proposito,
// para nao ser lido por programa. Mas o ESTADO vem em texto puro no campo
// `qualid`, e saber que existem 39 anuncios NM e so 2 HP ja diz muito.
function contarPorEstado(html, idEdicao, num) {
  const m = html.match(/var\s+cards_stock\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) return null;

  let anuncios;
  try { anuncios = JSON.parse(m[1]); } catch (e) { return null; }
  if (!Array.isArray(anuncios) || !anuncios.length) return null;

  const contagem = {};
  let total = 0;

  anuncios.forEach(function (a) {
    if (idEdicao != null && String(a.idEdicao) !== String(idEdicao)) return;
    if (num && String(a.num) !== String(num)) return;
    const sigla = QUALIDADES[Number(a.qualid)];
    if (!sigla) return;
    contagem[sigla] = (contagem[sigla] || 0) + 1;
    total++;
  });

  return total ? { porEstado: contagem, total: total } : null;
}

function parseCardPage(html, numPedido) {
  const m = html.match(/var\s+cards_editions\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) return null;

  let edicoes;
  try { edicoes = JSON.parse(m[1]); } catch (e) { return null; }
  if (!Array.isArray(edicoes) || !edicoes.length) return null;

  const t = html.match(/<title>([^<]*)<\/title>/i);
  const tituloBruto = t ? limpar(t[1].split('|')[0]) : '';
  const partes = separarNumero(tituloBruto);

  const extras = lerExtras(html);

  return edicoes.map(function (e) {
    // As chaves de `price` sao as VERSOES da carta, nao um consolidado: "0" e a
    // Normal, "2" a Foil, "3" a Reverse Foil... Cada uma tem seu proprio menor,
    // medio e maior preco, e sao esses os numeros que a Liga mostra no bloco
    // "Preco Medio de Venda no Marketplace".
    const precos = e.price || {};
    const versoes = Object.keys(precos).map(function (k) {
      const v = precos[k] || {};
      return {
        id: k,
        nome: nomeDaVersao(k, extras),
        precoMin: num0(v.p),
        precoMed: num0(v.m),
        precoMax: num0(v.g),
      };
    }).filter(function (v) {
      return v.precoMin != null || v.precoMed != null;
    }).sort(function (a, b) {
      return (a.precoMin == null ? Infinity : a.precoMin) - (b.precoMin == null ? Infinity : b.precoMin);
    });

    // O preco que representa a carta e o da versao mais barata disponivel.
    const p = versoes.length
      ? { p: versoes[0].precoMin, m: versoes[0].precoMed, g: versoes[0].precoMax }
      : {};

    const num = String(e.num == null ? (numPedido || '') : e.num);
    const estoque = contarPorEstado(html, e.id, num);
    return {
      versoes: versoes,
      anuncios: estoque ? estoque.porEstado : null,
      anunciosTotal: estoque ? estoque.total : null,
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

// Diagnostico: ?debug=1 conta exatamente o que a LigaPokemon respondeu para
// ESTE servidor. Existe porque o resultado muda conforme de onde sai o pedido
// — a Liga fica atras do Cloudflare, que barra parte das faixas de IP de
// nuvem. Rodando no PC funciona; rodando no Netlify pode voltar 403.
async function diagnostico(alvo) {
  const inicio = Date.now();
  try {
    const resp = await fetch(alvo, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      signal: AbortSignal.timeout(20000),
    });
    const corpo = await resp.text();
    const cab = {};
    ['server', 'cf-ray', 'cf-mitigated', 'content-type', 'retry-after'].forEach(function (k) {
      const v = resp.headers.get(k);
      if (v) cab[k] = v;
    });
    return {
      passou: resp.ok,
      status: resp.status,
      ms: Date.now() - inicio,
      cabecalhos: cab,
      // O CF-RAY termina com o codigo do ponto de presenca (GRU = Sao Paulo).
      inicioDoCorpo: corpo.slice(0, 220).replace(/\s+/g, ' '),
      tamanho: corpo.length,
    };
  } catch (e) {
    return { passou: false, erro: String(e && e.message ? e.message : e), ms: Date.now() - inicio };
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  const url = new URL(req.url);

  if (url.searchParams.get('debug')) {
    const nomeDbg = (url.searchParams.get('nome') || 'Pikachu').trim();
    const alvo = BASE + '?view=cards/search&card=' + encodeURIComponent(nomeDbg);
    const d = await diagnostico(alvo);
    return new Response(JSON.stringify({ alvo: alvo, resultado: d }, null, 1),
      { status: 200, headers: CORS });
  }

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
