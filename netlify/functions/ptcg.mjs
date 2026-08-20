// ============================================================================
//  Netlify Function: /.netlify/functions/ptcg
//  ---------------------------------------------------------------------------
//  Proxy para a API pokemontcg.io — o "banco de dados" das cartas.
//  E ela quem traduz um "125/197" lido pela camera na carta exata, com imagem,
//  colecao e preco de referencia (TCGPlayer USD / Cardmarket EUR).
//
//  Por que passar por aqui em vez de chamar direto do navegador:
//    - a API deles cai com 500/502 com alguma frequencia; aqui ha repeticao
//      automatica antes de desistir;
//    - cache em memoria evita repetir a mesma consulta;
//    - se um dia voce criar uma chave gratis em https://dev.pokemontcg.io,
//      basta por em POKEMONTCG_API_KEY nas variaveis do Netlify (a chave nao
//      fica exposta no navegador).
//
//  Chamadas:
//    /.netlify/functions/ptcg?num=125&total=197     -> identifica pelo numero
//    /.netlify/functions/ptcg?nome=charizard        -> busca por nome
//    /.netlify/functions/ptcg?id=sv3-125            -> uma carta especifica
// ============================================================================

const API = 'https://api.pokemontcg.io/v2';
const CACHE = new Map();
const TTL_MS = 30 * 60 * 1000;
const MAX_CACHE = 400;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function cabecalhos() {
  const h = { Accept: 'application/json' };
  const chave = process.env.POKEMONTCG_API_KEY;
  if (chave) h['X-Api-Key'] = chave;
  return h;
}

// A API cai de vez em quando (500/502). Tenta de novo antes de desistir.
async function buscarComRetentativa(url, tentativas = 4) {
  let ultimoErro = null;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(url, { headers: cabecalhos(), signal: AbortSignal.timeout(12000) });
      if (resp.ok) return resp.json();
      if (resp.status === 404) return { data: [] };
      if (resp.status < 500) throw new Error('pokemontcg.io respondeu ' + resp.status);
      ultimoErro = new Error('pokemontcg.io respondeu ' + resp.status);
    } catch (e) {
      ultimoErro = e;
    }
    if (i < tentativas - 1) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
  }
  throw ultimoErro || new Error('falha desconhecida');
}

// Escolhe o preco de mercado mais representativo entre as variantes do TCGPlayer.
function melhorPrecoTCG(tcgplayer) {
  if (!tcgplayer || !tcgplayer.prices) return null;
  const p = tcgplayer.prices;
  const ordem = ['holofoil', 'normal', 'reverseHolofoil', '1stEditionHolofoil', 'unlimitedHolofoil'];
  const chaves = ordem.filter((k) => p[k]).concat(Object.keys(p).filter((k) => ordem.indexOf(k) === -1));
  for (const k of chaves) {
    const v = p[k];
    if (!v) continue;
    const mercado = v.market != null ? v.market : v.mid;
    if (mercado != null) {
      return { variante: k, market: mercado, low: v.low != null ? v.low : null };
    }
  }
  return null;
}

// Reduz a resposta gigante da API ao que o app realmente usa.
function simplificar(card) {
  const tcg = melhorPrecoTCG(card.tcgplayer);
  const cm = card.cardmarket && card.cardmarket.prices ? card.cardmarket.prices : null;
  const set = card.set || {};
  return {
    id: card.id,
    nome: card.name,
    num: card.number,
    total: set.printedTotal != null ? String(set.printedTotal) : '',
    totalReal: set.total != null ? String(set.total) : '',
    set: set.name || '',
    setId: set.id || '',
    serie: set.series || '',
    lancamento: set.releaseDate || '',
    simbolo: set.images ? set.images.symbol : '',
    imagem: card.images ? card.images.small : '',
    imagemGrande: card.images ? card.images.large : '',
    raridade: card.rarity || '',
    artista: card.artist || '',
    supertipo: card.supertype || '',
    precoUSD: tcg ? tcg.market : null,
    precoUSDbaixo: tcg ? tcg.low : null,
    variante: tcg ? tcg.variante : '',
    precoEUR: cm ? (cm.trendPrice != null ? cm.trendPrice : cm.averageSellPrice) : null,
    linkTCG: card.tcgplayer ? card.tcgplayer.url : '',
    atualizadoEm: card.tcgplayer ? card.tcgplayer.updatedAt : '',
  };
}

// O numero impresso pode vir com zero a esquerda ("025"), mas a API guarda "25".
function semZeros(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s.replace(/^0+(?=\d)/, '');
}

function montarConsultas(params) {
  const id = (params.get('id') || '').trim();
  if (id) return [{ tipo: 'id', valor: id }];

  const nome = (params.get('nome') || '').trim();
  const num = semZeros(params.get('num') || '');
  const total = semZeros(params.get('total') || '');

  const lista = [];
  // Do mais especifico para o mais amplo. Para na primeira que retornar algo.
  if (num && total) {
    lista.push({ tipo: 'q', valor: 'number:"' + num + '" set.printedTotal:' + total });
    lista.push({ tipo: 'q', valor: 'number:"' + num + '" set.total:' + total });
  }
  if (nome && num) lista.push({ tipo: 'q', valor: 'name:"' + nome + '*" number:"' + num + '"' });
  if (nome) lista.push({ tipo: 'q', valor: 'name:"' + nome + '*"' });
  if (num && !total) lista.push({ tipo: 'q', valor: 'number:"' + num + '"' });
  return lista;
}

// ---------------------------------------------------------------------------
//  Fonte reserva: tcgdex.net
//  Nao tem preco, mas identifica a carta e nunca esteve fora do ar nos testes.
//  Entra em acao so quando a pokemontcg.io falha, para o scanner nao morrer.
// ---------------------------------------------------------------------------

const TCGDEX = 'https://api.tcgdex.net/v2/en';
let setsReserva = null;
let setsReservaEm = 0;

async function carregarSetsReserva() {
  if (setsReserva && Date.now() - setsReservaEm < 24 * 60 * 60 * 1000) return setsReserva;
  const resp = await fetch(TCGDEX + '/sets', { signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error('tcgdex respondeu ' + resp.status);
  setsReserva = await resp.json();
  setsReservaEm = Date.now();
  return setsReserva;
}

function simplificarReserva(c) {
  const set = c.set || {};
  const contagem = set.cardCount || {};
  return {
    id: c.id,
    nome: c.name,
    num: String(c.localId == null ? '' : c.localId),
    total: contagem.official != null ? String(contagem.official) : '',
    totalReal: contagem.total != null ? String(contagem.total) : '',
    set: set.name || '',
    setId: set.id || '',
    serie: '',
    lancamento: '',
    simbolo: set.symbol ? set.symbol + '.png' : '',
    imagem: c.image ? c.image + '/low.webp' : '',
    imagemGrande: c.image ? c.image + '/high.webp' : '',
    raridade: c.rarity || '',
    artista: c.illustrator || '',
    supertipo: c.category || '',
    precoUSD: null,
    precoUSDbaixo: null,
    variante: '',
    precoEUR: null,
    linkTCG: '',
    atualizadoEm: '',
    reserva: true,
  };
}

async function detalharReserva(ids) {
  const cartas = await Promise.all(ids.map(async (id) => {
    try {
      const r = await fetch(TCGDEX + '/cards/' + encodeURIComponent(id), { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      return simplificarReserva(await r.json());
    } catch (e) {
      return null;
    }
  }));
  return cartas.filter(Boolean);
}

async function buscarNomeNaReserva(nome, limite) {
  if (!nome) return [];
  const resp = await fetch(TCGDEX + '/cards?name=like:' + encodeURIComponent(nome),
    { signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error('tcgdex respondeu ' + resp.status);
  const lista = await resp.json();
  if (!Array.isArray(lista) || !lista.length) return [];

  // A lista vem da colecao mais antiga para a mais nova; o interessante e o
  // que saiu recentemente.
  const ids = lista.slice(-Math.min(limite || 24, 24)).reverse().map((c) => c.id);
  return detalharReserva(ids);
}

async function buscarNaReserva(num, total) {
  if (!num || !total) return [];
  const sets = await carregarSetsReserva();
  const alvo = Number(total);
  const candidatos = sets
    .filter((s) => s.cardCount && (s.cardCount.official === alvo || s.cardCount.total === alvo))
    .slice(0, 8);

  const cartas = await Promise.all(candidatos.map(async (s) => {
    try {
      const r = await fetch(TCGDEX + '/cards/' + s.id + '-' + num, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      return simplificarReserva(await r.json());
    } catch (e) {
      return null;
    }
  }));

  return cartas.filter(Boolean);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  const url = new URL(req.url);

  // ?totais=1 -> lista de quantos cards cada colecao tem (".../197", "/165").
  // O scanner usa isso para jogar fora leitura impossivel: se o OCR entendeu
  // "677/378" e nenhuma colecao tem 378 cards, aquilo nao e uma carta.
  if (url.searchParams.get('totais')) {
    try {
      const sets = await carregarSetsReserva();
      const vistos = new Set();
      sets.forEach((s) => {
        if (!s.cardCount) return;
        if (s.cardCount.official) vistos.add(s.cardCount.official);
        if (s.cardCount.total) vistos.add(s.cardCount.total);
      });
      const totais = Array.from(vistos).filter((n) => n > 0 && n < 1000).sort((a, b) => a - b);
      return new Response(JSON.stringify({ totais: totais }),
        { status: 200, headers: Object.assign({}, CORS, { 'Cache-Control': 'public, max-age=86400' }) });
    } catch (e) {
      return new Response(JSON.stringify({ totais: [] }), { status: 200, headers: CORS });
    }
  }

  const consultas = montarConsultas(url.searchParams);
  if (!consultas.length) {
    return new Response(JSON.stringify({ erro: 'Informe nome, num+total ou id.', cartas: [] }),
      { status: 400, headers: CORS });
  }

  const limite = Math.min(parseInt(url.searchParams.get('limite') || '24', 10) || 24, 50);
  const chave = JSON.stringify(consultas) + '|' + limite;

  const guardado = CACHE.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) {
    return new Response(JSON.stringify(Object.assign({}, guardado.dados, { cache: true })),
      { status: 200, headers: Object.assign({}, CORS, { 'Cache-Control': 'public, max-age=600' }) });
  }

  try {
    let cartas = [];
    let usada = '';

    for (const c of consultas) {
      const alvo = c.tipo === 'id'
        ? API + '/cards/' + encodeURIComponent(c.valor)
        : API + '/cards?q=' + encodeURIComponent(c.valor) +
          '&pageSize=' + limite + '&orderBy=-set.releaseDate';

      const json = await buscarComRetentativa(alvo);
      const dados = Array.isArray(json.data) ? json.data : (json.data ? [json.data] : []);
      if (dados.length) {
        cartas = dados.map(simplificar);
        usada = c.valor;
        break;
      }
    }

    const dados = { fonte: 'pokemontcg.io', consulta: usada, cartas: cartas };
    CACHE.set(chave, { em: Date.now(), dados: dados });
    if (CACHE.size > MAX_CACHE) CACHE.delete(CACHE.keys().next().value);

    return new Response(JSON.stringify(dados),
      { status: 200, headers: Object.assign({}, CORS, { 'Cache-Control': 'public, max-age=600' }) });
  } catch (e) {
    // pokemontcg.io fora do ar: tenta identificar a carta pela fonte reserva.
    try {
      const num = semZeros(url.searchParams.get('num') || '');
      const total = semZeros(url.searchParams.get('total') || '');
      const nome = (url.searchParams.get('nome') || '').trim();

      let cartas = await buscarNaReserva(num, total);
      if (!cartas.length && nome) cartas = await buscarNomeNaReserva(nome, limite);

      if (cartas.length) {
        const dados = {
          fonte: 'tcgdex.net',
          consulta: 'reserva',
          aviso: 'pokemontcg.io indisponivel — carta identificada pela fonte reserva, sem preco USD/EUR.',
          cartas: cartas,
        };
        CACHE.set(chave, { em: Date.now(), dados: dados });
        return new Response(JSON.stringify(dados), { status: 200, headers: CORS });
      }
    } catch (e2) { /* reserva tambem falhou */ }

    return new Response(JSON.stringify({ erro: String(e && e.message ? e.message : e), cartas: [] }),
      { status: 502, headers: CORS });
  }
};
