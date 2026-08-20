/* ==========================================================================
   api.js — conversa com as fontes de dados
   --------------------------------------------------------------------------
   Duas funções rodam no servidor do Netlify:
     /.netlify/functions/ptcg  -> identifica a carta (pokemontcg.io / tcgdex)
     /.netlify/functions/liga  -> preço em reais na LigaPokémon

   Se o site estiver sendo aberto como arquivo estático (sem `netlify dev`),
   as funções não existem. Nesse caso a identificação cai direto na
   pokemontcg.io, que aceita chamadas do navegador; a LigaPokémon não tem
   como funcionar sem servidor e o app avisa isso na tela.
   ========================================================================== */

const Api = (function () {

  const FUNCS = '/.netlify/functions';
  let temFuncoes = null; // null = ainda não sabemos

  function limparNumero(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^\d+$/.test(s)) return s;
    return String(parseInt(s, 10)); // "025" -> "25"
  }

  async function pegarJson(url) {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    const texto = await resp.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch (e) {
      throw new Error('Resposta inesperada do servidor (' + resp.status + ').');
    }
    if (!resp.ok && json && json.erro) throw new Error(json.erro);
    return json;
  }

  // --- plano B: falar direto com a pokemontcg.io ---------------------------

  function simplificarDireto(card) {
    const set = card.set || {};
    const p = card.tcgplayer && card.tcgplayer.prices ? card.tcgplayer.prices : null;
    let usd = null;
    let variante = '';
    if (p) {
      const chaves = Object.keys(p);
      for (let i = 0; i < chaves.length; i++) {
        const v = p[chaves[i]];
        const m = v.market != null ? v.market : v.mid;
        if (m != null) { usd = m; variante = chaves[i]; break; }
      }
    }
    const cm = card.cardmarket && card.cardmarket.prices ? card.cardmarket.prices : null;
    return {
      id: card.id,
      nome: card.name,
      num: card.number,
      total: set.printedTotal != null ? String(set.printedTotal) : '',
      set: set.name || '',
      setId: set.id || '',
      serie: set.series || '',
      lancamento: set.releaseDate || '',
      imagem: card.images ? card.images.small : '',
      imagemGrande: card.images ? card.images.large : '',
      raridade: card.rarity || '',
      artista: card.artist || '',
      precoUSD: usd,
      variante: variante,
      precoEUR: cm ? (cm.trendPrice != null ? cm.trendPrice : cm.averageSellPrice) : null,
      linkTCG: card.tcgplayer ? card.tcgplayer.url : '',
    };
  }

  async function direto(consulta, limite) {
    const url = 'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(consulta) +
      '&pageSize=' + (limite || 24) + '&orderBy=-set.releaseDate';
    const json = await pegarJson(url);
    return { fonte: 'pokemontcg.io (direto)', cartas: (json.data || []).map(simplificarDireto) };
  }

  // --- identificação -------------------------------------------------------

  async function chamarPtcg(params) {
    const qs = new URLSearchParams(params).toString();

    if (temFuncoes !== false) {
      try {
        const json = await pegarJson(FUNCS + '/ptcg?' + qs);
        temFuncoes = true;
        return json;
      } catch (e) {
        if (temFuncoes === true) throw e; // as funções existem, o erro é real
        temFuncoes = false;               // rodando sem servidor: cai no plano B
      }
    }

    const num = limparNumero(params.num || '');
    const total = limparNumero(params.total || '');
    const nome = params.nome || '';
    if (params.id) {
      const j = await pegarJson('https://api.pokemontcg.io/v2/cards/' + encodeURIComponent(params.id));
      return { fonte: 'pokemontcg.io (direto)', cartas: j.data ? [simplificarDireto(j.data)] : [] };
    }
    if (num && total) {
      const r = await direto('number:"' + num + '" set.printedTotal:' + total, params.limite);
      if (r.cartas.length) return r;
    }
    if (nome) return direto('name:"' + nome + '*"', params.limite);
    if (num) return direto('number:"' + num + '"', params.limite);
    return { fonte: '', cartas: [] };
  }

  // Identifica pelo número lido no rodapé da carta.
  function identificarPorNumero(num, total, nome) {
    const p = { num: num, total: total };
    if (nome) p.nome = nome;
    return chamarPtcg(p);
  }

  function buscarPorNome(nome, limite) {
    return chamarPtcg({ nome: nome, limite: limite || 24 });
  }

  function porId(id) {
    return chamarPtcg({ id: id });
  }

  // --- LigaPokémon ---------------------------------------------------------

  async function liga(nome, num, total) {
    if (temFuncoes === false) {
      return { resultados: [], indisponivel: true };
    }
    const p = new URLSearchParams({ nome: nome });
    if (num) p.set('num', String(num));
    if (total) p.set('total', String(total));
    try {
      const json = await pegarJson(FUNCS + '/liga?' + p.toString());
      temFuncoes = true;
      return json;
    } catch (e) {
      if (temFuncoes === null) temFuncoes = false;
      return { resultados: [], erro: String(e.message || e), indisponivel: temFuncoes === false };
    }
  }

  // --- totais de coleção conhecidos ---------------------------------------
  //
  // Serve para o scanner descartar leitura impossível: se o OCR entendeu
  // "677/378" e nenhuma coleção do jogo tem 378 cards, aquilo não é carta.

  let totaisCache = null;

  async function totaisConhecidos() {
    if (totaisCache) return totaisCache;

    try {
      const guardado = JSON.parse(localStorage.getItem('cc.totais') || 'null');
      if (guardado && Date.now() - guardado.em < 7 * 24 * 60 * 60 * 1000 && guardado.totais.length) {
        totaisCache = new Set(guardado.totais);
        return totaisCache;
      }
    } catch (e) { /* cache inválido, busca de novo */ }

    if (temFuncoes === false) return null;

    try {
      const j = await pegarJson(FUNCS + '/ptcg?totais=1');
      if (!j.totais || !j.totais.length) return null;
      totaisCache = new Set(j.totais);
      try {
        localStorage.setItem('cc.totais', JSON.stringify({ em: Date.now(), totais: j.totais }));
      } catch (e) { /* sem espaço, tudo bem */ }
      return totaisCache;
    } catch (e) {
      return null;
    }
  }

  // --- cotação -------------------------------------------------------------

  async function cotacoes() {
    const j = await pegarJson('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL');
    const usd = j.USDBRL ? Number(j.USDBRL.bid) : null;
    const eur = j.EURBRL ? Number(j.EURBRL.bid) : null;
    return {
      usdBrl: Number.isFinite(usd) && usd > 0 ? usd : null,
      eurBrl: Number.isFinite(eur) && eur > 0 ? eur : null,
    };
  }

  return {
    identificarPorNumero: identificarPorNumero,
    buscarPorNome: buscarPorNome,
    porId: porId,
    liga: liga,
    totaisConhecidos: totaisConhecidos,
    cotacoes: cotacoes,
    semServidor: function () { return temFuncoes === false; },
  };
})();
