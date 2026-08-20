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
  };

  const CONFIG_PADRAO = {
    usdBrl: 5.4,
    eurBrl: 6.0,
    lerNome: true,
    consultarLiga: true,
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
    return Object.assign({}, CONFIG_PADRAO, ler(CHAVES.config, {}));
  }

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

  // --- exportar / importar -------------------------------------------------

  function exportar() {
    return {
      app: 'compfindr',
      versao: 1,
      em: new Date().toISOString(),
      wishlist: lista('wishlist'),
      colecao: lista('colecao'),
      config: config(),
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
  }

  function apagarTudo() {
    Object.keys(CHAVES).forEach(function (k) { localStorage.removeItem(CHAVES[k]); });
  }

  return {
    config: config,
    salvarConfig: salvarConfig,
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
