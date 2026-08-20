/* ==========================================================================
   api.js — conversa com as fontes de dados
   --------------------------------------------------------------------------
   A fonte principal é a tcgdex.net, chamada DIRETO do navegador.

   Antes o app passava pela pokemontcg.io. Medido em 2026-08-20: ela responde
   erro 502 em cerca de 3 de cada 5 chamadas. Como havia retentativa com
   espera crescente, cada consulta gastava segundos antes de desistir — era
   essa a causa da lentidão. A tcgdex respondeu 100% das vezes em ~0,7s,
   aceita chamada direta (tem CORS liberado) e traz preço de TCGPlayer e
   Cardmarket atualizado diariamente. Ou seja: mais rápida, mais confiável e
   sem precisar passar pelo servidor.

   A lista de coleções é baixada uma vez e guardada por uma semana. Com ela
   na mão, identificar "125/197" não custa busca nenhuma: o total (197) diz
   quais coleções têm esse tamanho, e aí basta pedir a carta 125 de cada uma.

   O preço em reais continua vindo da LigaPokémon, que precisa do servidor
   (o navegador bloquearia por CORS).
   ========================================================================== */

const Api = (function () {

  const TCG = 'https://api.tcgdex.net/v2/en';
  const FUNCS = '/.netlify/functions';
  const CHAVE_SETS = 'cc.sets.v2';
  const VALIDADE_SETS = 7 * 24 * 60 * 60 * 1000;

  let mapaSets = null;    // id da coleção -> dados dela
  let porTotal = null;    // quantidade de cards -> ids de coleções desse tamanho
  let carregandoSets = null;
  let temFuncoes = null;  // null = ainda não sabemos se o servidor existe

  // --- utilidades ----------------------------------------------------------

  function semZeros(v) {
    const s = String(v == null ? '' : v).trim();
    return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
  }

  async function pegarJson(url, ms) {
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ms || 15000),
    });
    const texto = await resp.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch (e) {
      throw new Error('Resposta inesperada (' + resp.status + ').');
    }
    if (!resp.ok && json && json.erro) throw new Error(json.erro);
    if (!resp.ok) throw new Error('Servidor respondeu ' + resp.status + '.');
    return json;
  }

  // --- coleções ------------------------------------------------------------

  function indexarSets(lista, excluir) {
    mapaSets = {};
    porTotal = {};
    lista.forEach(function (s, i) {
      if (excluir && excluir[s.id]) return;
      const c = s.cardCount || {};
      mapaSets[s.id] = {
        id: s.id,
        nome: s.name || s.id,
        oficial: c.official || 0,
        total: c.total || 0,
        simbolo: s.symbol ? s.symbol + '.png' : '',
        ordem: i, // a lista vem da mais antiga para a mais nova
      };
      [c.official, c.total].forEach(function (n) {
        if (!n) return;
        if (!porTotal[n]) porTotal[n] = [];
        if (porTotal[n].indexOf(s.id) === -1) porTotal[n].push(s.id);
      });
    });
  }

  // As coleções do Pokémon TCG Pocket (o jogo de celular) não são cartas de
  // verdade e atrapalham de dois jeitos: aparecem na busca por nome e, pior,
  // colidem por número — "Paldean Wonders" tem 131 cards, o mesmo total de
  // Prismatic Evolutions, então um "161/131" podia cair na coleção errada.
  // Ficam de fora por padrão; dá para religar em Ajustes.
  async function idsDoPocket() {
    try {
      const s = await pegarJson(TCG + '/series/tcgp', 15000);
      const fora = {};
      (s.sets || []).forEach(function (x) { fora[x.id] = true; });
      return fora;
    } catch (e) {
      return {};
    }
  }

  function querPocket() {
    try {
      return !!(typeof Store !== 'undefined' && Store.config().incluirPocket);
    } catch (e) {
      return false;
    }
  }

  async function carregarSets() {
    if (mapaSets) return mapaSets;
    if (carregandoSets) return carregandoSets;

    carregandoSets = (async function () {
      try {
        const guardado = JSON.parse(localStorage.getItem(CHAVE_SETS) || 'null');
        if (guardado && Date.now() - guardado.em < VALIDADE_SETS && guardado.lista.length) {
          indexarSets(guardado.lista, querPocket() ? null : (guardado.pocket || {}));
          return mapaSets;
        }
      } catch (e) { /* cache ruim, baixa de novo */ }

      const [lista, pocket] = await Promise.all([
        pegarJson(TCG + '/sets', 20000),
        idsDoPocket(),
      ]);

      indexarSets(lista, querPocket() ? null : pocket);
      try {
        localStorage.setItem(CHAVE_SETS, JSON.stringify({ em: Date.now(), lista: lista, pocket: pocket }));
      } catch (e) { /* sem espaço, segue só em memória */ }
      return mapaSets;
    })();

    try {
      return await carregandoSets;
    } finally {
      carregandoSets = null;
    }
  }

  // Chamado quando a pessoa liga/desliga as cartas do jogo de celular.
  function reindexar() {
    mapaSets = null;
    porTotal = null;
    return carregarSets();
  }

  // --- conversão das cartas ------------------------------------------------

  // Escolhe o preço mais representativo entre as versões do TCGPlayer.
  function precoTCG(tcgplayer) {
    if (!tcgplayer) return null;
    const ordem = ['holofoil', 'normal', 'reverseHolofoil', 'firstEditionHolofoil', 'firstEditionNormal'];
    const chaves = ordem.filter(function (k) { return tcgplayer[k]; })
      .concat(Object.keys(tcgplayer).filter(function (k) {
        return ordem.indexOf(k) === -1 && tcgplayer[k] && typeof tcgplayer[k] === 'object';
      }));
    for (let i = 0; i < chaves.length; i++) {
      const v = tcgplayer[chaves[i]];
      const p = v.marketPrice != null ? v.marketPrice : v.midPrice;
      if (p != null) return { variante: chaves[i], valor: p, baixo: v.lowPrice != null ? v.lowPrice : null };
    }
    return null;
  }

  function simplificar(c) {
    const set = c.set || {};
    const contagem = set.cardCount || {};
    const preco = c.pricing || {};
    const tcg = precoTCG(preco.tcgplayer);
    const cm = preco.cardmarket;

    return {
      id: c.id,
      nome: c.name || '',
      num: String(c.localId == null ? '' : c.localId),
      total: contagem.official != null ? String(contagem.official) : '',
      totalReal: contagem.total != null ? String(contagem.total) : '',
      set: set.name || '',
      setId: set.id || '',
      lancamento: '',
      imagem: c.image ? c.image + '/low.webp' : '',
      imagemGrande: c.image ? c.image + '/high.webp' : '',
      raridade: c.rarity || '',
      artista: c.illustrator || '',
      supertipo: c.category || '',
      precoUSD: tcg ? tcg.valor : null,
      precoUSDbaixo: tcg ? tcg.baixo : null,
      variante: tcg ? tcg.variante : '',
      precoEUR: cm ? (cm.trend != null ? cm.trend : cm.avg) : null,
      completa: true,
    };
  }

  // A busca por nome devolve uma versão enxuta (sem coleção nem preço). O
  // nome da coleção sai do id ("sv03-125" -> "sv03"), sem gastar requisição.
  function simplificarBreve(b) {
    const corte = String(b.id || '').lastIndexOf('-');
    const setId = corte > 0 ? b.id.slice(0, corte) : '';
    const s = (mapaSets && mapaSets[setId]) || null;
    return {
      id: b.id,
      nome: b.name || '',
      num: String(b.localId == null ? '' : b.localId),
      total: s ? String(s.oficial) : '',
      set: s ? s.nome : '',
      setId: setId,
      ordem: s ? s.ordem : -1,
      imagem: b.image ? b.image + '/low.webp' : '',
      imagemGrande: b.image ? b.image + '/high.webp' : '',
      raridade: '',
      artista: '',
      precoUSD: null,
      precoEUR: null,
      completa: false,
    };
  }

  // --- identificação por número -------------------------------------------

  async function pegarCarta(setId, num) {
    try {
      const c = await pegarJson(TCG + '/cards/' + encodeURIComponent(setId + '-' + num), 12000);
      return c && c.id ? simplificar(c) : null;
    } catch (e) {
      return null; // essa coleção não tem carta com esse número
    }
  }

  // "125/197": o 197 diz quais coleções têm esse tamanho, o 125 diz a carta.
  // Nenhuma busca envolvida — só as consultas diretas, em paralelo.
  async function identificarPorNumero(num, total, nome) {
    const n = semZeros(num);
    const t = semZeros(total);

    if (!t) {
      if (nome) return buscarPorNome(nome, 24);
      throw new Error('Informe o total da coleção (o número depois da barra).');
    }

    await carregarSets();
    const ids = (porTotal && porTotal[Number(t)]) || [];
    if (!ids.length) return { fonte: 'tcgdex.net', cartas: [] };

    const tentativas = [];
    ids.slice(0, 12).forEach(function (id) {
      tentativas.push(pegarCarta(id, n));
      // Algumas coleções guardam o número com zero à esquerda.
      if (n.length < 3) tentativas.push(pegarCarta(id, n.padStart(3, '0')));
    });

    const achadas = (await Promise.all(tentativas)).filter(Boolean);

    // Tira repetidas e põe a coleção mais recente primeiro.
    const vistos = {};
    const cartas = achadas.filter(function (c) {
      if (vistos[c.id]) return false;
      vistos[c.id] = true;
      return true;
    }).sort(function (a, b) {
      const oa = mapaSets[a.setId] ? mapaSets[a.setId].ordem : 0;
      const ob = mapaSets[b.setId] ? mapaSets[b.setId].ordem : 0;
      return ob - oa;
    });

    return { fonte: 'tcgdex.net', cartas: cartas };
  }

  // --- busca por nome ------------------------------------------------------

  async function buscarPorNome(nome, limite) {
    const termo = String(nome || '').trim();
    if (!termo) return { fonte: '', cartas: [] };

    await carregarSets();
    const lista = await pegarJson(TCG + '/cards?name=like:' + encodeURIComponent(termo), 20000);
    if (!Array.isArray(lista)) return { fonte: 'tcgdex.net', cartas: [] };

    // Coleção fora do índice = coleção excluída (jogo de celular). Sai da lista.
    const cartas = lista.map(simplificarBreve)
      .filter(function (c) { return c.setId && mapaSets[c.setId]; })
      .sort(function (a, b) { return b.ordem - a.ordem; })
      .slice(0, limite || 24);

    return { fonte: 'tcgdex.net', cartas: cartas, totalEncontrado: lista.length };
  }

  // Completa uma carta que veio enxuta da busca (preço, raridade, artista).
  async function detalhar(id) {
    const c = await pegarJson(TCG + '/cards/' + encodeURIComponent(id), 12000);
    return c && c.id ? simplificar(c) : null;
  }

  function porId(id) {
    return detalhar(id).then(function (c) {
      return { fonte: 'tcgdex.net', cartas: c ? [c] : [] };
    });
  }

  // --- totais de coleção que existem de verdade ---------------------------
  //
  // O scanner usa isto para descartar leitura impossível: se nenhuma coleção
  // tem 378 cards, "677/378" não é carta.

  async function totaisConhecidos() {
    try {
      await carregarSets();
      return new Set(Object.keys(porTotal).map(Number));
    } catch (e) {
      return null;
    }
  }

  // --- LigaPokémon (precisa do servidor) ----------------------------------

  async function liga(nome, num, total) {
    if (temFuncoes === false) return { resultados: [], indisponivel: true };

    const p = new URLSearchParams({ nome: nome });
    if (num) p.set('num', String(num));
    if (total) p.set('total', String(total));

    try {
      const json = await pegarJson(FUNCS + '/liga?' + p.toString(), 25000);
      temFuncoes = true;
      return json;
    } catch (e) {
      if (temFuncoes === null) temFuncoes = false;
      return { resultados: [], erro: String(e.message || e), indisponivel: temFuncoes === false };
    }
  }

  // --- cotação -------------------------------------------------------------

  async function cotacoes() {
    const j = await pegarJson('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL', 12000);
    const usd = j.USDBRL ? Number(j.USDBRL.bid) : null;
    const eur = j.EURBRL ? Number(j.EURBRL.bid) : null;
    return {
      usdBrl: Number.isFinite(usd) && usd > 0 ? usd : null,
      eurBrl: Number.isFinite(eur) && eur > 0 ? eur : null,
    };
  }

  // --- reserva -------------------------------------------------------------
  //
  // A tcgdex é o único ponto de falha do app agora. Se ela cair, a função
  // /ptcg no servidor tenta a pokemontcg.io. É lenta e instável, mas é melhor
  // que o app parar de funcionar.

  async function pelaReserva(params) {
    if (temFuncoes === false) return { fonte: '', cartas: [] };
    const qs = new URLSearchParams(params).toString();
    const j = await pegarJson(FUNCS + '/ptcg?' + qs, 30000);
    temFuncoes = true;
    return {
      fonte: (j.fonte || 'reserva') + ' (reserva)',
      cartas: (j.cartas || []).map(function (c) {
        return Object.assign({}, c, { completa: true });
      }),
    };
  }

  async function comReserva(principal, params) {
    try {
      const r = await principal();
      if (r.cartas && r.cartas.length) return r;
      return r;
    } catch (e) {
      try {
        return await pelaReserva(params);
      } catch (e2) {
        throw e; // o erro que importa é o da fonte principal
      }
    }
  }

  return {
    carregarSets: carregarSets,
    reindexar: reindexar,
    identificarPorNumero: function (num, total, nome) {
      return comReserva(function () { return identificarPorNumero(num, total, nome); },
        { num: num, total: total });
    },
    buscarPorNome: function (nome, limite) {
      return comReserva(function () { return buscarPorNome(nome, limite); },
        { nome: nome, limite: limite || 24 });
    },
    detalhar: detalhar,
    porId: porId,
    totaisConhecidos: totaisConhecidos,
    liga: liga,
    cotacoes: cotacoes,
    semServidor: function () { return temFuncoes === false; },
  };
})();
