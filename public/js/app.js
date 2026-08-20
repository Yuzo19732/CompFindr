/* ==========================================================================
   app.js — a cola entre câmera, OCR, preços e tela
   ========================================================================== */

(function () {

  const $ = function (id) { return document.getElementById(id); };
  const cacheLiga = new Map();   // evita repetir consulta da mesma carta
  let ultimaLista = [];          // resultado do último scan/busca

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

  function chaveLiga(carta) {
    return (carta.nome || '') + '|' + (carta.num || '') + '|' + (carta.total || '');
  }

  // Cada consulta à LigaPokémon é uma leitura de página inteira do site deles.
  // Disparar 24 de uma vez seria abusivo e lento, então no máximo duas correm
  // ao mesmo tempo; o resto espera a vez.
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

  async function precoLiga(carta) {
    const k = chaveLiga(carta);
    if (cacheLiga.has(k)) return cacheLiga.get(k);

    const promessa = comLimite(function () {
      return Api.liga(carta.nome, carta.num, carta.total);
    }).then(function (r) {
      const achado = (r.resultados || [])[0] || null;
      return { achado: achado, indisponivel: !!r.indisponivel, erro: r.erro || null };
    });

    cacheLiga.set(k, promessa);
    return promessa;
  }

  // --- cartão de resultado -------------------------------------------------

  function elemCarta(carta, extras) {
    const b = document.createElement('button');
    b.className = 'carta';
    b.type = 'button';

    const img = document.createElement('img');
    img.src = carta.imagem || '';
    img.alt = carta.nome || 'carta';
    img.loading = 'lazy';

    const meio = document.createElement('div');
    const nome = document.createElement('div');
    nome.className = 'nome';
    nome.textContent = carta.nome || '(sem nome)';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [
      carta.set,
      carta.num ? carta.num + '/' + (carta.total || '?') : '',
      carta.raridade,
    ].filter(Boolean).join(' · ');
    meio.appendChild(nome);
    meio.appendChild(meta);

    const preco = document.createElement('div');
    preco.className = 'preco';
    preco.innerHTML = '<div class="carregando">buscando…</div>';

    b.appendChild(img);
    b.appendChild(meio);
    b.appendChild(preco);
    b.addEventListener('click', function () { abrirDetalhe(carta); });

    if (extras && extras.buscarLiga) {
      preencherPreco(preco, carta);
    } else {
      mostrarPrecoConhecido(preco, carta);
    }

    return b;
  }

  // Preço sem ir na rede: o que já está salvo na carta.
  function mostrarPrecoConhecido(el, carta) {
    const cfg = Store.config();
    el.innerHTML = '';
    if (carta.precoBRL != null) {
      el.innerHTML = '<div class="brl">' + brl(carta.precoBRL) + '</div>' +
        '<div class="usd">LigaPokémon</div>';
    } else if (carta.precoUSD != null) {
      el.innerHTML = '<div class="brl">' + brl(carta.precoUSD * cfg.usdBrl) + '</div>' +
        '<div class="usd">TCGPlayer</div>';
    } else {
      el.innerHTML = '<div class="usd">toque para ver</div>';
    }
  }

  async function preencherPreco(el, carta) {
    try {
      const r = await precoLiga(carta);
      if (r.achado && r.achado.precoMin != null) {
        el.innerHTML = '<div class="brl">' + brl(r.achado.precoMin) + '</div>' +
          '<div class="usd">médio ' + (brl(r.achado.precoMed) || '—') + '</div>';
        return;
      }
    } catch (e) { /* cai para o preço já conhecido */ }
    mostrarPrecoConhecido(el, carta);
  }

  // `buscarLiga` só liga para listas curtas (o resultado de um scan). Numa
  // busca com 24 cartas isso viraria 24 leituras do site da Liga de uma vez.
  function desenharResultados(el, cartas, vazioTexto) {
    el.innerHTML = '';
    if (!cartas.length) {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = vazioTexto;
      el.appendChild(p);
      return;
    }
    const buscarLiga = cartas.length <= 3;
    cartas.forEach(function (c) { el.appendChild(elemCarta(c, { buscarLiga: buscarLiga })); });
  }

  // --- detalhe da carta ----------------------------------------------------

  function linhaPreco(rotuloForte, rotuloFraco, valor, sub, principal) {
    const d = document.createElement('div');
    d.className = 'preco-linha' + (principal ? ' principal' : '');
    const r = document.createElement('div');
    r.className = 'rotulo';
    r.innerHTML = '<b>' + rotuloForte + '</b>' + (rotuloFraco || '');
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

  async function abrirDetalhe(carta) {
    const cfg = Store.config();
    const alvo = $('modal-conteudo');
    $('modal').classList.remove('oculto');

    alvo.innerHTML = '';

    const topo = document.createElement('div');
    topo.className = 'detalhe-topo';
    topo.innerHTML =
      '<img src="' + (carta.imagemGrande || carta.imagem || '') + '" alt="">' +
      '<div><h2 id="modal-titulo"></h2><div class="meta"></div></div>';
    topo.querySelector('h2').textContent = carta.nome || '(sem nome)';
    topo.querySelector('.meta').textContent = [
      carta.set,
      carta.num ? 'nº ' + carta.num + '/' + (carta.total || '?') : '',
      carta.raridade,
      carta.artista ? 'arte: ' + carta.artista : '',
    ].filter(Boolean).join('\n');
    topo.querySelector('.meta').style.whiteSpace = 'pre-line';
    alvo.appendChild(topo);

    const precos = document.createElement('div');
    precos.className = 'precos';
    precos.innerHTML = '<p class="ajuda">Buscando preços…</p>';
    alvo.appendChild(precos);

    const acoes = document.createElement('div');
    acoes.className = 'acoes-detalhe';
    alvo.appendChild(acoes);

    // Preenchido quando a consulta à Liga volta. Guardado junto da carta para
    // a wishlist somar em reais sem precisar consultar tudo de novo.
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
          const comPreco = precoBRL == null
            ? carta
            : Object.assign({}, carta, { precoBRL: precoBRL });
          const agora = Store.alternar(nome, comPreco);
          avisar(agora ? 'Adicionado à ' + par[1] : 'Removido da ' + par[1]);
          desenharAcoes();
        });
        acoes.appendChild(b);
      });
    }
    desenharAcoes();

    // Preços — a LigaPokémon é a referência principal, em reais.
    let r = { achado: null, indisponivel: false };
    try {
      r = await precoLiga(carta);
    } catch (e) { /* segue com o que tiver */ }

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
    } else if (r.indisponivel) {
      const p = document.createElement('p');
      p.className = 'ajuda';
      p.textContent = 'O preço da LigaPokémon precisa do servidor do site. Publique no Netlify ou rode com "netlify dev".';
      precos.appendChild(p);
    } else {
      const p = document.createElement('p');
      p.className = 'ajuda';
      p.textContent = 'Sem anúncio dessa carta na LigaPokémon agora.';
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

    if (r.achado && r.achado.url) {
      const a = document.createElement('a');
      a.className = 'link-liga';
      a.href = r.achado.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Ver anúncios na LigaPokémon →';
      precos.appendChild(a);
    }

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

  // --- escanear ------------------------------------------------------------

  const elStatus = $('status-scan');
  const elBarra = $('barra-progresso');
  const elProg = $('progresso');

  function progresso(fracao) {
    if (fracao == null) {
      elBarra.classList.add('oculto');
      return;
    }
    elBarra.classList.remove('oculto');
    elProg.style.width = Math.round(fracao * 100) + '%';
  }

  $('btn-camera').addEventListener('click', async function () {
    try {
      status(elStatus, 'Pedindo acesso à câmera…');
      await Scanner.ligar($('video'), $('guia'), $('camera-caixa'));
      $('camera-vazia').classList.add('oculto');
      $('barra-camera').hidden = false;
      $('btn-lanterna').hidden = !Scanner.temLanterna();
      status(elStatus, 'Encaixe a carta na moldura. A faixa vermelha tem que cobrir o número do rodapé.');
    } catch (e) {
      status(elStatus, e.message || String(e), 'erro');
    }
  });

  $('btn-parar').addEventListener('click', function () {
    Scanner.desligar();
    $('camera-vazia').classList.remove('oculto');
    $('barra-camera').hidden = true;
    status(elStatus, '');
  });

  $('btn-lanterna').addEventListener('click', async function () {
    const ligada = await Scanner.alternarLanterna();
    $('btn-lanterna').classList.toggle('ativo', ligada);
  });

  $('btn-capturar').addEventListener('click', async function () {
    const btn = $('btn-capturar');
    btn.disabled = true;
    try {
      await escanear();
    } catch (e) {
      status(elStatus, e.message || String(e), 'erro');
    } finally {
      btn.disabled = false;
      progresso(null);
    }
  });

  // --- desempate pelo nome -------------------------------------------------

  function soLetras(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  // Maior trecho em comum entre duas palavras. É o que resiste ao lixo do OCR:
  // "jiFPikachy" e "pikachu" compartilham "pikach".
  function maiorTrechoComum(a, b) {
    if (!a || !b) return 0;
    let melhor = 0;
    const linha = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let anterior = 0;
      for (let j = 1; j <= b.length; j++) {
        const guardado = linha[j];
        if (a[i - 1] === b[j - 1]) {
          linha[j] = anterior + 1;
          if (linha[j] > melhor) melhor = linha[j];
        } else {
          linha[j] = 0;
        }
        anterior = guardado;
      }
    }
    return melhor;
  }

  // Escolhe a carta cujo nome mais se parece com o que o OCR leu — mas só
  // quando a diferença for clara. Na dúvida, devolve null e o app mostra
  // todas as opções para a pessoa escolher.
  function melhorPorNome(cartas, textoLido) {
    const lido = soLetras(textoLido);
    if (lido.length < 4) return null;

    const notas = cartas.map(function (c) {
      const nome = soLetras(c.nome);
      if (!nome) return { carta: c, nota: 0 };
      return { carta: c, nota: maiorTrechoComum(lido, nome) / nome.length };
    }).sort(function (a, b) { return b.nota - a.nota; });

    const primeiro = notas[0];
    const segundo = notas[1] || { nota: 0 };
    if (primeiro.nota >= 0.5 && primeiro.nota - segundo.nota >= 0.15) return primeiro.carta;
    return null;
  }

  async function escanear() {
    const cfg = Store.config();
    const captura = Scanner.capturar();

    status(elStatus, 'Preparando o leitor…');
    progresso(0.05);
    await Ocr.preparar(function (etapa, fracao) {
      if (etapa && etapa.indexOf('load') !== -1) {
        status(elStatus, 'Baixando o leitor de texto (só na primeira vez)…');
        progresso(0.05 + fracao * 0.30);
      }
    });

    status(elStatus, 'Lendo o número da carta…');
    const leitura = await Ocr.lerNumero(captura.quadro, captura.numero, function (f) {
      progresso(0.35 + f * 0.30);
    });

    if (!leitura.candidatos.length) {
      status(elStatus,
        'Não consegui ler o número' + (leitura.texto ? ' (li "' + leitura.texto + '")' : '') +
        '. Aproxime mais, melhore a luz ou digite o número na mão abaixo.', 'erro');
      return;
    }

    // O OCR erra o traço "/" às vezes, então ele devolve várias leituras
    // possíveis. Quem decide qual é a certa é a base: a primeira que existir
    // de verdade ganha.
    progresso(0.7);

    // Antes de gastar consulta, joga fora o impossível: total que nenhuma
    // coleção do jogo tem.
    let candidatos = leitura.candidatos;
    try {
      const totais = await Api.totaisConhecidos();
      if (totais) {
        const filtrados = candidatos.filter(function (c) { return totais.has(Number(c.total)); });
        if (filtrados.length) candidatos = filtrados;
      }
    } catch (e) { /* sem a lista, tenta todos mesmo */ }

    let cartas = [];
    let acertou = null;

    for (let i = 0; i < Math.min(candidatos.length, 8); i++) {
      const c = candidatos[i];
      status(elStatus, 'Conferindo ' + c.num + '/' + c.total + '…');
      try {
        const r = await Api.identificarPorNumero(c.num, c.total, '');
        if (r.cartas && r.cartas.length) {
          cartas = r.cartas;
          acertou = c;
          break;
        }
      } catch (e) { /* tenta o próximo candidato */ }
    }

    if (!acertou) {
      const tentados = candidatos.slice(0, 3)
        .map(function (c) { return c.num + '/' + c.total; }).join(', ');
      status(elStatus,
        'Li algo parecido com ' + tentados + ', mas nenhuma dessas cartas existe na base. ' +
        'Tente de novo com mais luz ou digite o número na mão.', 'erro');
      desenharResultados($('resultado-scan'), [], '');
      return;
    }

    // Duas coleções podem ter o mesmo total. Aí o nome desempata.
    if (cartas.length > 1 && cfg.lerNome) {
      status(elStatus, acertou.num + '/' + acertou.total + ' deu ' + cartas.length +
        ' cartas. Lendo o nome para desempatar…');
      progresso(0.88);
      try {
        const n = await Ocr.lerNome(captura.quadro, captura.nome);
        const escolhida = melhorPorNome(cartas, n.texto);
        if (escolhida) cartas = [escolhida];
      } catch (e) { /* segue mostrando todas as opções */ }
    }

    progresso(1);
    ultimaLista = cartas;

    status(elStatus,
      cartas.length === 1
        ? 'Achei: ' + cartas[0].nome + ' — ' + cartas[0].set + ' (' + acertou.num + '/' + acertou.total + ').'
        : 'Achei ' + cartas.length + ' possibilidades para ' + acertou.num + '/' + acertou.total + '. Escolha a certa:',
      'bom');

    desenharResultados($('resultado-scan'), cartas, '');
    if (cartas.length === 1) abrirDetalhe(cartas[0]);
  }

  // --- identificação manual ------------------------------------------------

  $('btn-manual').addEventListener('click', async function () {
    const num = $('in-num').value.trim();
    const total = $('in-total').value.trim();
    const nome = $('in-nome-manual').value.trim();

    if (!num) { status(elStatus, 'Digite pelo menos o número da carta.', 'erro'); return; }

    status(elStatus, 'Procurando…');
    try {
      const r = await Api.identificarPorNumero(num, total, nome);
      const cartas = r.cartas || [];
      ultimaLista = cartas;
      status(elStatus, cartas.length ? 'Achei ' + cartas.length + ' resultado(s).' : 'Nada encontrado.',
        cartas.length ? 'bom' : 'erro');
      desenharResultados($('resultado-scan'), cartas, 'Nada encontrado com esse número.');
      if (cartas.length === 1) abrirDetalhe(cartas[0]);
    } catch (e) {
      status(elStatus, e.message || String(e), 'erro');
    }
  });

  // --- buscar por nome -----------------------------------------------------

  async function buscar() {
    const termo = $('in-busca').value.trim();
    if (!termo) return;
    status($('status-busca'), 'Buscando…');
    try {
      const r = await Api.buscarPorNome(termo, 24);
      const cartas = r.cartas || [];
      status($('status-busca'), cartas.length + ' resultado(s).', cartas.length ? 'bom' : '');
      desenharResultados($('resultado-busca'), cartas, 'Nenhuma carta com esse nome.');
    } catch (e) {
      status($('status-busca'), e.message || String(e), 'erro');
    }
  }

  $('btn-busca').addEventListener('click', buscar);
  $('in-busca').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') buscar();
  });

  // --- wishlist e coleção --------------------------------------------------

  function desenharLista(nome) {
    const el = $('lista-' + nome);
    const cartas = Store.lista(nome);
    el.innerHTML = '';

    if (!cartas.length) {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = nome === 'wishlist'
        ? 'Nada na wishlist ainda.\nEscaneie ou busque uma carta e toque em "Adicionar à Wishlist".'
        : 'Sua coleção está vazia.\nEscaneie as cartas que você já tem para montar o inventário.';
      p.style.whiteSpace = 'pre-line';
      el.appendChild(p);
      atualizarTotal(nome, cartas);
      return;
    }

    cartas.forEach(function (c) {
      const linha = document.createElement('div');
      linha.style.position = 'relative';
      linha.appendChild(elemCarta(c));

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'btn pequeno perigo';
      x.textContent = '✕';
      x.title = 'Remover';
      x.style.position = 'absolute';
      x.style.top = '6px';
      x.style.right = '6px';
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        Store.remover(nome, c);
        desenharLista(nome);
        avisar('Removido.');
      });
      linha.appendChild(x);
      el.appendChild(linha);
    });

    atualizarTotal(nome, cartas);
  }

  function atualizarTotal(nome, cartas) {
    const cfg = Store.config();
    let soma = 0;
    let contados = 0;
    cartas.forEach(function (c) {
      if (c.precoBRL != null) { soma += c.precoBRL; contados++; }
      else if (c.precoUSD != null) { soma += c.precoUSD * cfg.usdBrl; contados++; }
    });
    const el = $('total-' + nome);
    el.textContent = cartas.length
      ? cartas.length + ' carta(s) · ' + (brl(soma) || 'R$ 0,00') + (contados < cartas.length ? ' (parcial)' : '')
      : '';
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
    $('chk-nome').checked = !!cfg.lerNome;
    $('chk-liga').checked = !!cfg.consultarLiga;
  }

  $('in-usd').addEventListener('change', function () {
    Store.salvarConfig({ usdBrl: Number($('in-usd').value) || 5.4 });
  });
  $('in-eur').addEventListener('change', function () {
    Store.salvarConfig({ eurBrl: Number($('in-eur').value) || 6.0 });
  });
  $('chk-nome').addEventListener('change', function () {
    Store.salvarConfig({ lerNome: $('chk-nome').checked });
  });
  $('chk-liga').addEventListener('change', function () {
    Store.salvarConfig({ consultarLiga: $('chk-liga').checked });
  });

  $('btn-cotacao').addEventListener('click', async function () {
    status($('status-cotacao'), 'Consultando…');
    try {
      const c = await Api.cotacoes();
      const nova = {};
      if (c.usdBrl) nova.usdBrl = Number(c.usdBrl.toFixed(2));
      if (c.eurBrl) nova.eurBrl = Number(c.eurBrl.toFixed(2));
      nova.cotacaoEm = Date.now();
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
        avisar('Backup restaurado.');
      } catch (err) {
        avisar(err.message || 'Arquivo inválido.');
      }
    };
    leitor.readAsText(f);
  });

  $('btn-limpar').addEventListener('click', function () {
    if (!confirm('Apagar wishlist, coleção e ajustes deste aparelho?')) return;
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

  if (!Scanner.contextoSeguro()) {
    $('dica-https').textContent =
      'Atenção: a câmera só funciona em HTTPS. Neste endereço o navegador vai bloquear.';
  }

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
