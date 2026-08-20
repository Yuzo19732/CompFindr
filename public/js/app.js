/* ==========================================================================
   app.js — a cola entre a busca, os preços e a tela
   ========================================================================== */

(function () {

  const $ = function (id) { return document.getElementById(id); };
  const cacheLiga = new Map();   // evita repetir consulta da mesma carta

  // --- formatação ----------------------------------------------------------

  function brl(n) {
    if (n == null || !Number.isFinite(Number(n))) return null;
    return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function moeda(n, cod) {
    if (n == null || !Number.isFinite(Number(n))) return null;
    return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: cod });
  }

  function avisar(texto, ms) {
    const el = $('aviso');
    el.textContent = texto;
    el.classList.remove('oculto');
    clearTimeout(avisar._t);
    avisar._t = setTimeout(function () { el.classList.add('oculto'); }, ms || 2600);
  }

  function status(el, texto, classe) {
    el.textContent = texto || '';
    el.className = 'status' + (classe ? ' ' + classe : '');
  }

  // --- navegação por abas --------------------------------------------------

  function mostrarView(nome) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('ativa', v.id === 'view-' + nome);
    });
    document.querySelectorAll('.aba').forEach(function (a) {
      a.classList.toggle('ativa', a.dataset.view === nome);
    });
    if (nome === 'wishlist') desenharLista('wishlist');
    if (nome === 'colecao') desenharLista('colecao');
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.aba').forEach(function (a) {
    a.addEventListener('click', function () { mostrarView(a.dataset.view); });
  });

  // --- preço da LigaPokémon ------------------------------------------------
  //
  // Cada consulta é uma leitura de página inteira do site deles. Disparar uma
  // por carta de uma vez seria abusivo e lento, então no máximo duas correm ao
  // mesmo tempo; o resto espera a vez.

  let emVoo = 0;
  const fila = [];

  function comLimite(tarefa) {
    return new Promise(function (resolver, rejeitar) {
      function tentar() {
        if (emVoo >= 2) { fila.push(tentar); return; }
        emVoo++;
        tarefa().then(resolver, rejeitar).finally(function () {
          emVoo--;
          const proxima = fila.shift();
          if (proxima) proxima();
        });
      }
      tentar();
    });
  }

  function chaveLiga(carta) {
    return (carta.nome || '') + '|' + (carta.num || '') + '|' + (carta.total || '');
  }

  async function precoLiga(carta) {
    const k = chaveLiga(carta);
    if (cacheLiga.has(k)) return cacheLiga.get(k);

    const promessa = comLimite(function () {
      return Api.liga(carta.nome, carta.num, carta.total);
    }).then(function (r) {
      return {
        achado: (r.resultados || [])[0] || null,
        // Serve mesmo sem anúncio nenhum: é por onde a pessoa confere a carta
        // na Liga por conta própria.
        urlBusca: r.urlBusca || '',
        indisponivel: !!r.indisponivel,
        erro: r.erro || null,
      };
    });

    cacheLiga.set(k, promessa);
    return promessa;
  }

  // --- cartão de resultado -------------------------------------------------

  function elemCarta(carta, extras) {
    const b = document.createElement('button');
    b.className = 'carta';
    b.type = 'button';

    const arte = document.createElement('div');
    arte.className = 'arte';
    if (carta.imagem) {
      const img = document.createElement('img');
      img.src = carta.imagem;
      img.alt = carta.nome || 'carta';
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        img.remove();
        arte.innerHTML = '<span class="sem-imagem">▦</span>';
      });
      arte.appendChild(img);
    } else {
      arte.innerHTML = '<span class="sem-imagem">▦</span>';
    }

    const info = document.createElement('div');
    info.className = 'info';

    const nome = document.createElement('div');
    nome.className = 'nome';
    nome.textContent = carta.nome || '(sem nome)';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [
      carta.num ? carta.num + '/' + (carta.total || '?') : '',
      carta.set,
    ].filter(Boolean).join(' · ');

    const preco = document.createElement('div');
    preco.className = 'preco';
    preco.innerHTML = '<div class="carregando">buscando…</div>';

    info.appendChild(nome);
    info.appendChild(meta);
    info.appendChild(preco);
    b.appendChild(arte);
    b.appendChild(info);
    b.addEventListener('click', function () { abrirDetalhe(carta); });

    if (extras && extras.buscarLiga) preencherPreco(preco, carta);
    else mostrarPrecoConhecido(preco, carta);

    if (extras && extras.removerDe) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'remover';
      x.textContent = '✕';
      x.title = 'Remover';
      x.setAttribute('aria-label', 'Remover ' + (carta.nome || 'carta'));
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        Store.remover(extras.removerDe, carta);
        desenharLista(extras.removerDe);
        avisar('Removido.');
      });
      b.appendChild(x);
    }

    return b;
  }

  // Preço sem ir na rede: o que já está guardado sobre a carta.
  function mostrarPrecoConhecido(el, carta) {
    const cfg = Store.config();
    const meu = Store.precoManual(carta);

    if (meu != null) {
      el.innerHTML = '<div class="brl">' + brl(meu) + '</div><div class="fonte">seu preço</div>';
    } else if (carta.precoBRL != null) {
      el.innerHTML = '<div class="brl">' + brl(carta.precoBRL) + '</div><div class="fonte">LigaPokémon</div>';
    } else if (carta.precoUSD != null) {
      el.innerHTML = '<div class="brl">' + brl(carta.precoUSD * cfg.usdBrl) + '</div><div class="fonte">TCGPlayer</div>';
    } else {
      el.innerHTML = '<div class="fonte">toque para ver</div>';
    }
  }

  async function preencherPreco(el, carta) {
    try {
      const r = await precoLiga(carta);
      if (r.achado && r.achado.precoMin != null) {
        el.innerHTML = '<div class="brl">' + brl(r.achado.precoMin) + '</div>' +
          '<div class="fonte">LigaPokémon</div>';
        return;
      }
    } catch (e) { /* cai para o preço já conhecido */ }
    mostrarPrecoConhecido(el, carta);
  }

  function vazio(el, icone, texto) {
    el.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'vazio';
    p.innerHTML = '<span class="ico">' + icone + '</span>';
    p.appendChild(document.createTextNode(texto));
    el.appendChild(p);
  }

  // `buscarLiga` só liga para listas curtas. Numa busca com 24 cartas isso
  // viraria 24 leituras do site da Liga de uma vez.
  function desenharResultados(el, cartas, vazioTexto) {
    if (!cartas.length) { vazio(el, '⌕', vazioTexto); return; }

    el.innerHTML = '';
    const buscarLiga = cartas.length <= 3 && Store.config().consultarLiga;
    cartas.forEach(function (c) { el.appendChild(elemCarta(c, { buscarLiga: buscarLiga })); });
    if (!buscarLiga) completarPrecos(el, cartas);
  }

  // A busca por nome devolve a carta enxuta, sem preço — assim ela aparece na
  // tela em menos de meio segundo. Os preços entram logo depois, em paralelo.
  function completarPrecos(el, cartas) {
    const caixas = el.querySelectorAll('.carta .preco');
    cartas.slice(0, 16).forEach(function (c, i) {
      if (c.completa || !c.id) return;
      Api.detalhar(c.id).then(function (cheia) {
        if (!cheia) return;
        Object.assign(c, cheia);
        if (caixas[i]) mostrarPrecoConhecido(caixas[i], c);
      }).catch(function () { /* fica sem preço mesmo */ });
    });
  }

  // --- detalhe da carta ----------------------------------------------------

  function linhaPreco(rotuloForte, rotuloFraco, valor, sub, principal) {
    const d = document.createElement('div');
    d.className = 'preco-linha' + (principal ? ' principal' : '');

    const r = document.createElement('div');
    r.className = 'rotulo';
    const b = document.createElement('b');
    b.textContent = rotuloForte;
    r.appendChild(b);
    r.appendChild(document.createTextNode(rotuloFraco || ''));

    const v = document.createElement('div');
    v.className = 'valor' + (principal ? ' verde' : '');
    v.textContent = valor;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      v.appendChild(s);
    }

    d.appendChild(r);
    d.appendChild(v);
    return d;
  }

  // --- preço por estado de conservação -------------------------------------
  //
  // A LigaPokémon publica o preço de cada anúncio como IMAGEM: cada dígito é um
  // pedaço de um JPEG, posicionado por CSS. Isso é proteção deliberada contra
  // leitura por programa, então o preço real de cada estado não tem como chegar
  // sozinho — e fingir que chega seria pior que não ter.
  //
  // O que dá para fazer, e é o que este bloco faz:
  //   · o ESTADO de cada anúncio vem em texto puro, então mostramos quantos
  //     anúncios existem de cada um (saber que há 39 NM e só 2 HP já orienta);
  //   · cada estado tem um campo para anotar o preço visto na Liga — o link
  //     está logo abaixo, é abrir e copiar os seis números uma vez;
  //   · o que não foi anotado aparece como estimativa, a partir das proporções
  //     de mercado editáveis em Ajustes.

  function baseDeReferencia(carta, achado, cfg) {
    const meu = Store.precoManual(carta);
    if (meu != null) return { valor: meu, texto: 'preço que você anotou' };
    if (achado && achado.precoMed != null) {
      return { valor: achado.precoMed, texto: 'preço médio na LigaPokémon' };
    }
    if (achado && achado.precoMin != null) {
      return { valor: achado.precoMin, texto: 'menor preço na LigaPokémon' };
    }
    if (carta.precoUSD != null) {
      return { valor: carta.precoUSD * cfg.usdBrl, texto: 'preço de mercado do TCGPlayer' };
    }
    if (carta.precoEUR != null) {
      return { valor: carta.precoEUR * cfg.eurBrl, texto: 'tendência do Cardmarket' };
    }
    return null;
  }

  function blocoEstados(carta, achado, cfg, aoMudar) {
    const caixa = document.createElement('div');
    caixa.className = 'estados';

    const titulo = document.createElement('div');
    titulo.className = 'estados-titulo';
    titulo.textContent = 'Preço por estado';
    caixa.appendChild(titulo);

    const legenda = document.createElement('p');
    legenda.className = 'ajuda';
    legenda.textContent = 'Anote o que você viu na Liga. O que ficar em branco vira estimativa.';
    caixa.appendChild(legenda);

    const base = baseDeReferencia(carta, achado, cfg);
    const anotados = Store.precosEstado(carta);
    const anuncios = (achado && achado.anuncios) || null;

    Store.ESTADOS.forEach(function (e) {
      const anotado = Number(anotados[e.sigla]);
      const temAnotado = Number.isFinite(anotado) && anotado > 0;

      const linha = document.createElement('div');
      linha.className = 'estado-linha' + (temAnotado ? ' anotado' : '');

      const sigla = document.createElement('span');
      sigla.className = 'sigla';
      sigla.textContent = e.sigla;

      const desc = document.createElement('span');
      desc.className = 'descricao';
      desc.textContent = e.nome;
      if (anuncios) {
        const qtd = anuncios[e.sigla] || 0;
        const marca = document.createElement('span');
        marca.className = 'qtd' + (qtd ? '' : ' zero');
        marca.textContent = qtd ? qtd + (qtd === 1 ? ' anúncio' : ' anúncios') : 'sem anúncio';
        desc.appendChild(document.createElement('br'));
        desc.appendChild(marca);
      }

      const campo = document.createElement('input');
      campo.type = 'number';
      campo.min = '0';
      campo.step = '0.01';
      campo.inputMode = 'decimal';
      campo.setAttribute('aria-label', 'Preço da carta em estado ' + e.nome);
      // Em branco, mostra a estimativa como sugestão — some ao digitar.
      campo.placeholder = base ? formatarSimples(base.valor * cfg.estados[e.sigla]) : '0,00';
      if (temAnotado) campo.value = anotado;

      campo.addEventListener('change', function () {
        Store.salvarPrecoEstado(carta, e.sigla, campo.value);
        const ref = Store.precoManual(carta);
        ['wishlist', 'colecao'].forEach(function (n) {
          if (Store.tem(n, carta)) {
            Store.atualizar(n, { id: carta.id, num: carta.num, total: carta.total, precoBRL: ref });
          }
        });
        if (aoMudar) aoMudar();
      });

      linha.appendChild(sigla);
      linha.appendChild(desc);
      linha.appendChild(campo);
      caixa.appendChild(linha);
    });

    const nota = document.createElement('p');
    nota.className = 'ajuda';
    if (base) {
      nota.textContent = 'As sugestões em cinza saem do ' + base.texto + ' (' +
        brl(base.valor) + '), tratado como NM. A Liga publica o preço de cada anúncio ' +
        'como imagem, então esse número não vem sozinho.';
    } else {
      nota.textContent = 'Sem preço de referência para sugerir valores.';
    }
    caixa.appendChild(nota);

    return caixa;
  }

  // "1234.5" -> "1234,50", que é como o campo espera receber.
  function formatarSimples(n) {
    if (n == null || !Number.isFinite(Number(n))) return '0,00';
    return Number(n).toFixed(2).replace('.', ',');
  }

  async function abrirDetalhe(carta) {
    const cfg = Store.config();
    const alvo = $('modal-conteudo');
    $('modal').classList.remove('oculto');
    alvo.innerHTML = '';

    // Carta vinda da busca por nome chega enxuta: sem preço, raridade nem
    // artista. Completa agora, que é quando esses dados vão aparecer.
    if (!carta.completa && carta.id) {
      try {
        const cheia = await Api.detalhar(carta.id);
        if (cheia) carta = Object.assign(carta, cheia);
      } catch (e) { /* mostra o que tem */ }
    }

    const topo = document.createElement('div');
    topo.className = 'detalhe-topo';
    const img = document.createElement('img');
    img.src = carta.imagemGrande || carta.imagem || '';
    img.alt = '';
    const lado = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.id = 'modal-titulo';
    h2.textContent = carta.nome || '(sem nome)';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [
      carta.set,
      carta.num ? 'nº ' + carta.num + '/' + (carta.total || '?') : '',
      carta.raridade,
      carta.artista ? 'arte: ' + carta.artista : '',
    ].filter(Boolean).join('\n');
    lado.appendChild(h2);
    lado.appendChild(meta);
    topo.appendChild(img);
    topo.appendChild(lado);
    alvo.appendChild(topo);

    const precos = document.createElement('div');
    precos.className = 'precos';
    precos.innerHTML = '<p class="ajuda">Buscando preços…</p>';
    alvo.appendChild(precos);

    const acoes = document.createElement('div');
    acoes.className = 'acoes-detalhe';
    alvo.appendChild(acoes);

    let precoBRL = null;

    function desenharAcoes() {
      acoes.innerHTML = '';
      [['wishlist', 'Wishlist'], ['colecao', 'Coleção']].forEach(function (par) {
        const nome = par[0];
        const dentro = Store.tem(nome, carta);
        const b = document.createElement('button');
        b.className = 'btn' + (dentro ? '' : ' primario');
        b.type = 'button';
        b.textContent = (dentro ? 'Remover da ' : 'Adicionar à ') + par[1];
        b.addEventListener('click', function () {
          const comPreco = precoBRL == null ? carta : Object.assign({}, carta, { precoBRL: precoBRL });
          const agora = Store.alternar(nome, comPreco);
          avisar(agora ? 'Adicionado à ' + par[1] : 'Removido da ' + par[1]);
          desenharAcoes();
        });
        acoes.appendChild(b);
      });
    }
    desenharAcoes();

    let r = { achado: null, urlBusca: '', indisponivel: false, erro: null };
    if (cfg.consultarLiga) {
      try { r = await precoLiga(carta); } catch (e) { /* segue com o que tiver */ }
    }

    precos.innerHTML = '';

    if (r.achado && r.achado.precoMin != null) {
      const l = r.achado;
      precoBRL = l.precoMin;
      desenharAcoes();
      precos.appendChild(linhaPreco(
        'LigaPokémon', 'menor preço anunciado',
        brl(l.precoMin),
        'médio ' + (brl(l.precoMed) || '—') + '  ·  maior ' + (brl(l.precoMax) || '—'),
        true
      ));
    } else if (cfg.consultarLiga) {
      const p = document.createElement('p');
      p.className = 'ajuda';
      // Dois problemas diferentes, que confundem se forem descritos igual:
      // não existe servidor, ou existe mas a Liga recusou o pedido dele.
      p.textContent = /403|502|respondeu/.test(String(r.erro || ''))
        ? 'A LigaPokémon está recusando o pedido do servidor do site (ela usa Cloudflare, ' +
          'que barra endereços de nuvem). Abra pelo link abaixo e anote o preço aqui.'
        : (r.indisponivel
          ? 'O preço da LigaPokémon precisa do servidor do site.'
          : (r.achado
            ? 'A LigaPokémon tem essa carta cadastrada, mas ninguém está vendendo agora.'
            : 'Sem anúncio dessa carta na LigaPokémon agora.'));
      precos.appendChild(p);
    }

    if (carta.precoUSD != null) {
      precos.appendChild(linhaPreco(
        'TCGPlayer', 'mercado dos EUA' + (carta.variante ? ' · ' + carta.variante : ''),
        brl(carta.precoUSD * cfg.usdBrl),
        moeda(carta.precoUSD, 'USD') + ' × ' + cfg.usdBrl.toFixed(2)
      ));
    }
    if (carta.precoEUR != null) {
      precos.appendChild(linhaPreco(
        'Cardmarket', 'tendência na Europa',
        brl(carta.precoEUR * cfg.eurBrl),
        moeda(carta.precoEUR, 'EUR') + ' × ' + cfg.eurBrl.toFixed(2)
      ));
    }

    function redesenharEstados() {
      precoBRL = Store.precoManual(carta);
      desenharAcoes();
      const velho = precos.querySelector('.estados');
      const novo = blocoEstados(carta, r.achado, Store.config(), redesenharEstados);
      if (velho) velho.replaceWith(novo);
    }

    precos.appendChild(blocoEstados(carta, r.achado, cfg, redesenharEstados));

    // O link vai sempre, tenha anúncio ou não — é assim que dá para conferir a
    // carta na Liga mesmo quando ninguém está vendendo.
    const destino = (r.achado && r.achado.url) || r.urlBusca ||
      ('https://www.ligapokemon.com.br/?view=cards/search&card=' +
        encodeURIComponent(carta.nome || ''));
    const a = document.createElement('a');
    a.className = 'link-liga';
    a.href = destino;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = (r.achado && r.achado.precoMin != null)
      ? 'Ver anúncios na LigaPokémon →'
      : 'Abrir essa carta na LigaPokémon →';
    precos.appendChild(a);

    // Se a carta já estava salva, aproveita e atualiza o preço guardado.
    if (precoBRL != null) {
      ['wishlist', 'colecao'].forEach(function (n) {
        if (Store.tem(n, carta)) {
          Store.atualizar(n, { id: carta.id, num: carta.num, total: carta.total, precoBRL: precoBRL });
        }
      });
    }
  }

  document.querySelectorAll('[data-fechar]').forEach(function (el) {
    el.addEventListener('click', function () { $('modal').classList.add('oculto'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') $('modal').classList.add('oculto');
  });

  // --- busca ---------------------------------------------------------------
  //
  // Um campo só. Se o que foi digitado parece o número do rodapé — "125/197",
  // "125 197", "125-197" — vale como número; senão, vale como nome. Separar em
  // dois campos só obrigaria a pessoa a escolher antes de digitar.

  function lerNumero(termo) {
    const m = String(termo || '').trim().match(/^(\d{1,3})\s*[\/\-\s]\s*(\d{1,3})$/);
    if (!m) return null;
    return { num: String(parseInt(m[1], 10)), total: String(parseInt(m[2], 10)) };
  }

  const elStatusBusca = $('status-busca');
  const elResultado = $('resultado-busca');

  async function buscar() {
    const termo = $('in-busca').value.trim();
    if (!termo) return;

    const numero = lerNumero(termo);
    status(elStatusBusca, 'Procurando…');
    elResultado.innerHTML = '';

    try {
      const r = numero
        ? await Api.identificarPorNumero(numero.num, numero.total)
        : await Api.buscarPorNome(termo, 24);

      const cartas = r.cartas || [];

      if (!cartas.length) {
        status(elStatusBusca, numero
          ? 'Nenhuma carta com o número ' + numero.num + '/' + numero.total + '.'
          : 'Nenhuma carta com esse nome.', 'erro');
        vazio(elResultado, '⌕', numero
          ? 'Confira o número no rodapé da carta.\nO segundo número é o total da coleção.'
          : 'Tente outro nome, ou busque pelo número do rodapé.');
        return;
      }

      status(elStatusBusca, numero
        ? (cartas.length === 1
          ? 'Achei: ' + cartas[0].nome + ' — ' + cartas[0].set + '.'
          : cartas.length + ' coleções têm uma carta ' + numero.num + '/' + numero.total + '. Escolha a certa:')
        : cartas.length + ' resultado(s).', 'bom');

      desenharResultados(elResultado, cartas, '');
      if (numero && cartas.length === 1) abrirDetalhe(cartas[0]);
    } catch (e) {
      status(elStatusBusca, e.message || String(e), 'erro');
    }
  }

  $('btn-busca').addEventListener('click', buscar);
  $('in-busca').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('in-busca').blur(); buscar(); }
  });

  // --- wishlist e coleção --------------------------------------------------

  function desenharLista(nome) {
    const el = $('lista-' + nome);
    const cartas = Store.lista(nome);

    if (!cartas.length) {
      vazio(el, nome === 'wishlist' ? '★' : '▦', nome === 'wishlist'
        ? 'Nada na wishlist ainda.\nBusque uma carta e toque em "Adicionar à Wishlist".'
        : 'Sua coleção está vazia.\nBusque as cartas que você já tem para montar o inventário.');
      atualizarTotal(nome, cartas);
      return;
    }

    el.innerHTML = '';
    cartas.forEach(function (c) {
      el.appendChild(elemCarta(c, { removerDe: nome }));
    });
    atualizarTotal(nome, cartas);
  }

  function atualizarTotal(nome, cartas) {
    const cfg = Store.config();
    let soma = 0;
    let contados = 0;

    cartas.forEach(function (c) {
      const meu = Store.precoManual(c);
      if (meu != null) { soma += meu; contados++; }
      else if (c.precoBRL != null) { soma += c.precoBRL; contados++; }
      else if (c.precoUSD != null) { soma += c.precoUSD * cfg.usdBrl; contados++; }
    });

    const el = $('total-' + nome);
    if (!cartas.length) { el.textContent = 'nenhuma carta ainda'; return; }
    el.innerHTML = cartas.length + ' carta(s) · <b>' + (brl(soma) || 'R$ 0,00') + '</b>' +
      (contados < cartas.length ? ' <span class="ajuda">(parcial)</span>' : '');
  }

  async function atualizarPrecos(nome) {
    const cartas = Store.lista(nome);
    if (!cartas.length) return;

    avisar('Atualizando ' + cartas.length + ' carta(s)…', 4000);
    cacheLiga.clear();

    for (let i = 0; i < cartas.length; i++) {
      const c = cartas[i];
      try {
        const r = await precoLiga(c);
        if (r.achado && r.achado.precoMin != null) {
          Store.atualizar(nome, { id: c.id, num: c.num, total: c.total, precoBRL: r.achado.precoMin });
        }
      } catch (e) { /* segue para a próxima */ }
    }

    desenharLista(nome);
    avisar('Preços atualizados.');
  }

  $('btn-atualizar-wishlist').addEventListener('click', function () { atualizarPrecos('wishlist'); });
  $('btn-atualizar-colecao').addEventListener('click', function () { atualizarPrecos('colecao'); });

  // --- ajustes -------------------------------------------------------------

  function carregarAjustes() {
    const cfg = Store.config();
    $('in-usd').value = cfg.usdBrl;
    $('in-eur').value = cfg.eurBrl;
    $('chk-liga').checked = !!cfg.consultarLiga;
    $('chk-pocket').checked = !!cfg.incluirPocket;
    desenharEstados();
  }

  function desenharEstados() {
    const cfg = Store.config();
    const el = $('lista-estados');
    el.innerHTML = '';

    Store.ESTADOS.forEach(function (e) {
      const linha = document.createElement('div');
      linha.className = 'linha-estado';

      const sigla = document.createElement('span');
      sigla.className = 'sigla';
      sigla.textContent = e.sigla;

      const nome = document.createElement('span');
      nome.className = 'descricao';
      nome.textContent = e.nome;

      const campo = document.createElement('input');
      campo.type = 'number';
      campo.min = '0';
      campo.max = '300';
      campo.step = '1';
      campo.value = Math.round(cfg.estados[e.sigla] * 100);
      campo.setAttribute('aria-label', 'Proporção para ' + e.nome);
      campo.addEventListener('change', function () {
        const v = Number(campo.value);
        if (!Number.isFinite(v) || v < 0) { campo.value = Math.round(cfg.estados[e.sigla] * 100); return; }
        const estados = Object.assign({}, Store.config().estados);
        estados[e.sigla] = v / 100;
        Store.salvarConfig({ estados: estados });
      });

      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = '%';

      linha.appendChild(sigla);
      linha.appendChild(nome);
      linha.appendChild(campo);
      linha.appendChild(pct);
      el.appendChild(linha);
    });
  }

  $('btn-estados-padrao').addEventListener('click', function () {
    Store.salvarConfig({ estados: Object.assign({}, Store.ESTADOS_PADRAO) });
    desenharEstados();
    avisar('Proporções restauradas.');
  });

  $('in-usd').addEventListener('change', function () {
    Store.salvarConfig({ usdBrl: Number($('in-usd').value) || 5.4 });
  });
  $('in-eur').addEventListener('change', function () {
    Store.salvarConfig({ eurBrl: Number($('in-eur').value) || 6.0 });
  });
  $('chk-liga').addEventListener('change', function () {
    Store.salvarConfig({ consultarLiga: $('chk-liga').checked });
  });

  $('chk-pocket').addEventListener('change', async function () {
    Store.salvarConfig({ incluirPocket: $('chk-pocket').checked });
    try {
      await Api.reindexar();
      avisar($('chk-pocket').checked
        ? 'Cartas do jogo de celular incluídas.'
        : 'Cartas do jogo de celular removidas.');
    } catch (e) {
      avisar('Não consegui recarregar a lista de coleções.');
    }
  });

  $('btn-cotacao').addEventListener('click', async function () {
    status($('status-cotacao'), 'Consultando…');
    try {
      const c = await Api.cotacoes();
      const nova = { cotacaoEm: Date.now() };
      if (c.usdBrl) nova.usdBrl = Number(c.usdBrl.toFixed(2));
      if (c.eurBrl) nova.eurBrl = Number(c.eurBrl.toFixed(2));
      Store.salvarConfig(nova);
      carregarAjustes();
      status($('status-cotacao'), 'Cotação de hoje aplicada.', 'bom');
    } catch (e) {
      status($('status-cotacao'), 'Não consegui buscar a cotação. Preencha na mão.', 'erro');
    }
  });

  $('btn-exportar').addEventListener('click', function () {
    const dados = JSON.stringify(Store.exportar(), null, 2);
    const blob = new Blob([dados], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'compfindr-backup.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('btn-importar').addEventListener('click', function () { $('in-arquivo').click(); });

  $('in-arquivo').addEventListener('change', function (e) {
    const f = e.target.files[0];
    if (!f) return;
    const leitor = new FileReader();
    leitor.onload = function () {
      try {
        Store.importar(JSON.parse(leitor.result));
        carregarAjustes();
        desenharLista('wishlist');
        desenharLista('colecao');
        avisar('Backup restaurado.');
      } catch (err) {
        avisar(err.message || 'Arquivo inválido.');
      }
    };
    leitor.readAsText(f);
  });

  $('btn-limpar').addEventListener('click', function () {
    if (!confirm('Apagar wishlist, coleção, preços anotados e ajustes deste aparelho?')) return;
    Store.apagarTudo();
    carregarAjustes();
    desenharLista('wishlist');
    desenharLista('colecao');
    avisar('Tudo apagado.');
  });

  // --- instalação (PWA) ----------------------------------------------------

  let promptInstalar = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    promptInstalar = e;
    $('btn-instalar').classList.remove('oculto');
  });

  $('btn-instalar').addEventListener('click', async function () {
    if (!promptInstalar) return;
    promptInstalar.prompt();
    await promptInstalar.userChoice;
    promptInstalar = null;
    $('btn-instalar').classList.add('oculto');
  });

  window.addEventListener('appinstalled', function () {
    $('btn-instalar').classList.add('oculto');
    avisar('App instalado.');
  });

  // Em localhost o service worker atrapalha: ele guarda a versão antiga do
  // CSS/JS e some com o efeito de qualquer alteração. Só liga em produção.
  const emDesenvolvimento = ['localhost', '127.0.0.1', ''].indexOf(location.hostname) !== -1;

  if ('serviceWorker' in navigator) {
    if (emDesenvolvimento) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (r) { r.unregister(); });
      });
      if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); });
    } else {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () { /* sem offline, tudo bem */ });
      });
    }
  }

  // --- início --------------------------------------------------------------

  carregarAjustes();
  desenharLista('wishlist');
  desenharLista('colecao');

  // Deixa a lista de coleções pronta antes da primeira busca.
  Api.carregarSets().catch(function () { /* a busca tenta de novo */ });

  // Cotação envelhecida: atualiza sozinho uma vez por dia.
  (function () {
    const cfg = Store.config();
    if (Date.now() - (cfg.cotacaoEm || 0) > 24 * 60 * 60 * 1000) {
      Api.cotacoes().then(function (c) {
        const nova = { cotacaoEm: Date.now() };
        if (c.usdBrl) nova.usdBrl = Number(c.usdBrl.toFixed(2));
        if (c.eurBrl) nova.eurBrl = Number(c.eurBrl.toFixed(2));
        Store.salvarConfig(nova);
        carregarAjustes();
      }).catch(function () { /* usa o valor guardado */ });
    }
  })();

})();
