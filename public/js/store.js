/* ==========================================================================
   store.js — o que fica salvo no aparelho
   --------------------------------------------------------------------------
   Tudo vai para o localStorage do navegador. Não existe conta nem servidor
   guardando nada: se o usuário limpar os dados do navegador, some. Por isso
   existe o exportar/importar em Ajustes.
   ========================================================================== */

const Store = (function () {

  const CHAVES = {
    wishlist: 'cc.wishlist',
    colecao: 'cc.colecao',
    config: 'cc.config',
    precos: 'cc.precosBR',
    recentes: 'cc.recentes',
  };

  const MAX_RECENTES = 8;

  // Quanto vale uma carta em cada estado de conservação, em relação a uma NM.
  // São as siglas da LigaPokémon: M (Nova), NM (Praticamente Nova), SP (Usada
  // Levemente), MP (Usada Moderadamente), HP (Muito Usada), D (Danificada).
  //
  // Estes números são referência de mercado, não dado da Liga: o preço de cada
  // anúncio deles é publicado como imagem, justamente para não ser lido por
  // programa. Ficam editáveis porque a proporção varia por carta e por época.
  const ESTADOS_PADRAO = { M: 1.15, NM: 1.00, SP: 0.85, MP: 0.70, HP: 0.50, D: 0.30 };

  const CONFIG_PADRAO = {
    usdBrl: 5.4,
    eurBrl: 6.0,
    lerNome: true,
    consultarLiga: true,
    incluirPocket: false,   // cartas do jogo de celular (Pokémon TCG Pocket)
    estados: ESTADOS_PADRAO,
    cotacaoEm: 0,
  };

  function ler(chave, padrao) {
    try {
      const bruto = localStorage.getItem(chave);
      if (!bruto) return padrao;
      const v = JSON.parse(bruto);
      return v == null ? padrao : v;
    } catch (e) {
      return padrao;
    }
  }

  function gravar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (e) {
      // Cota estourada ou modo privativo.
      return false;
    }
  }

  // --- configuração --------------------------------------------------------

  function config() {
    const c = Object.assign({}, CONFIG_PADRAO, ler(CHAVES.config, {}));
    c.estados = Object.assign({}, ESTADOS_PADRAO, c.estados || {});
    return c;
  }

  const ORDEM_ESTADOS = [
    { sigla: 'M', nome: 'Nova' },
    { sigla: 'NM', nome: 'Praticamente Nova' },
    { sigla: 'SP', nome: 'Usada Levemente' },
    { sigla: 'MP', nome: 'Usada Moderadamente' },
    { sigla: 'HP', nome: 'Muito Usada' },
    { sigla: 'D', nome: 'Danificada' },
  ];

  function salvarConfig(parcial) {
    const nova = Object.assign(config(), parcial);
    gravar(CHAVES.config, nova);
    return nova;
  }

  // --- listas --------------------------------------------------------------

  function lista(nome) {
    const v = ler(CHAVES[nome], []);
    return Array.isArray(v) ? v : [];
  }

  // A chave de uma carta é o id da base (ex.: "sv3-125"). Quando a carta veio
  // só do número digitado, cai para "num/total".
  function chaveDe(carta) {
    if (carta.id) return String(carta.id);
    return (carta.num || '?') + '/' + (carta.total || '?');
  }

  function tem(nome, carta) {
    const k = chaveDe(carta);
    return lista(nome).some(function (c) { return chaveDe(c) === k; });
  }

  function adicionar(nome, carta) {
    const atual = lista(nome);
    const k = chaveDe(carta);
    if (atual.some(function (c) { return chaveDe(c) === k; })) return false;
    atual.unshift(Object.assign({}, carta, { addEm: Date.now() }));
    gravar(CHAVES[nome], atual);
    return true;
  }

  function remover(nome, carta) {
    const k = chaveDe(carta);
    const atual = lista(nome).filter(function (c) { return chaveDe(c) !== k; });
    gravar(CHAVES[nome], atual);
  }

  function alternar(nome, carta) {
    if (tem(nome, carta)) {
      remover(nome, carta);
      return false;
    }
    adicionar(nome, carta);
    return true;
  }

  // Substitui uma carta guardada por uma versão com preços novos.
  function atualizar(nome, carta) {
    const k = chaveDe(carta);
    const atual = lista(nome).map(function (c) {
      return chaveDe(c) === k ? Object.assign({}, c, carta) : c;
    });
    gravar(CHAVES[nome], atual);
  }

  // --- preço anotado à mão -------------------------------------------------
  //
  // A LigaPokémon fica atrás do Cloudflare, que barra o servidor do site. Como
  // não dá para trazer o preço em reais automaticamente, a pessoa pode abrir a
  // carta na Liga (o link está a um toque) e anotar aqui o valor que viu.
  //
  // Esse número passa a valer mais que qualquer outro: aparece nas listas,
  // soma no total da coleção e vira a base da tabela de estados.

  function precosManuais() {
    const v = ler(CHAVES.precos, {});
    return v && typeof v === 'object' ? v : {};
  }

  // Os preços anotados de uma carta, por estado: { NM: 39.9, D: 24.9 }.
  // O formato antigo guardava um valor só; ele passa a valer como NM.
  function precosEstado(carta) {
    const p = precosManuais()[chaveDe(carta)];
    if (!p) return {};
    if (p.estados && typeof p.estados === 'object') return p.estados;
    const antigo = Number(p.valor);
    return Number.isFinite(antigo) && antigo > 0 ? { NM: antigo } : {};
  }

  function salvarPrecoEstado(carta, sigla, valor) {
    const todos = precosManuais();
    const k = chaveDe(carta);
    const estados = Object.assign({}, precosEstado(carta));
    const n = Number(valor);

    if (!Number.isFinite(n) || n <= 0) delete estados[sigla];
    else estados[sigla] = n;

    if (!Object.keys(estados).length) delete todos[k];
    else todos[k] = { estados: estados, em: Date.now() };

    gravar(CHAVES.precos, todos);
    return estados;
  }

  // O valor que representa a carta nas listas e no total da coleção. Prefere a
  // NM, que é a referência do mercado; sem ela, pega o melhor estado anotado.
  function precoManual(carta) {
    const estados = precosEstado(carta);
    const valido = function (v) { return Number.isFinite(Number(v)) && Number(v) > 0; };

    if (valido(estados.NM)) return Number(estados.NM);

    for (let i = 0; i < ORDEM_ESTADOS.length; i++) {
      const v = estados[ORDEM_ESTADOS[i].sigla];
      if (valido(v)) return Number(v);
    }
    return null;
  }

  // --- vistas recentemente -------------------------------------------------
  //
  // Guarda o essencial de cada carta aberta, para a tela inicial ter o que
  // mostrar e para voltar numa carta sem precisar buscar de novo.

  function recentes() {
    const v = ler(CHAVES.recentes, []);
    return Array.isArray(v) ? v : [];
  }

  function registrarVisita(carta) {
    if (!carta || !carta.id) return;
    const k = chaveDe(carta);
    const enxuta = {
      id: carta.id, nome: carta.nome, num: carta.num, total: carta.total,
      set: carta.set, setId: carta.setId, raridade: carta.raridade,
      imagem: carta.imagem, imagemGrande: carta.imagemGrande,
      precoUSD: carta.precoUSD, precoEUR: carta.precoEUR, precoBRL: carta.precoBRL,
      completa: !!carta.completa,
    };
    const lista = recentes().filter(function (c) { return chaveDe(c) !== k; });
    lista.unshift(enxuta);
    gravar(CHAVES.recentes, lista.slice(0, MAX_RECENTES));
  }

  function limparRecentes() {
    localStorage.removeItem(CHAVES.recentes);
  }

  // --- exportar / importar -------------------------------------------------

  function exportar() {
    return {
      app: 'compfindr',
      versao: 1,
      em: new Date().toISOString(),
      wishlist: lista('wishlist'),
      colecao: lista('colecao'),
      config: config(),
      precosBR: precosManuais(),
    };
  }

  function importar(dados) {
    // 'cacacartas-web' era o nome antigo do app; backups daquela época
    // continuam valendo.
    const conhecidos = ['compfindr', 'cacacartas-web'];
    if (!dados || conhecidos.indexOf(dados.app) === -1) {
      throw new Error('Esse arquivo não é um backup do CompFindr.');
    }
    if (Array.isArray(dados.wishlist)) gravar(CHAVES.wishlist, dados.wishlist);
    if (Array.isArray(dados.colecao)) gravar(CHAVES.colecao, dados.colecao);
    if (dados.config) gravar(CHAVES.config, Object.assign({}, CONFIG_PADRAO, dados.config));
    if (dados.precosBR) gravar(CHAVES.precos, dados.precosBR);
  }

  function apagarTudo() {
    Object.keys(CHAVES).forEach(function (k) { localStorage.removeItem(CHAVES[k]); });
  }

  return {
    config: config,
    salvarConfig: salvarConfig,
    ESTADOS: ORDEM_ESTADOS,
    ESTADOS_PADRAO: ESTADOS_PADRAO,
    recentes: recentes,
    registrarVisita: registrarVisita,
    limparRecentes: limparRecentes,
    precoManual: precoManual,
    precosEstado: precosEstado,
    salvarPrecoEstado: salvarPrecoEstado,
    lista: lista,
    chaveDe: chaveDe,
    tem: tem,
    adicionar: adicionar,
    remover: remover,
    alternar: alternar,
    atualizar: atualizar,
    exportar: exportar,
    importar: importar,
    apagarTudo: apagarTudo,
  };
})();
