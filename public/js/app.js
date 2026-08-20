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
      return {
        achado: achado,
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
    if (!buscarLiga) completarPrecos(el, cartas);
  }

  // A busca por nome devolve a carta enxuta, sem preço — assim ela aparece na
  // tela em menos de meio segundo. Os preços entram logo depois, em paralelo.
  function completarPrecos(el, cartas) {
    const caixas = el.querySelectorAll('.carta .preco');
    cartas.slice(0, 14).forEach(function (c, i) {
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

  // --- preço por estado de conservação -------------------------------------
  //
  // A LigaPokémon publica o preço de cada anúncio como IMAGEM (sprite de CSS),
  // de propósito, para não ser lido por programa. Então não dá para trazer o
  // preço real de cada estado de lá, e inventar que dá seria pior.
  //
  // O que este bloco faz é aplicar as proporções de mercado sobre um preço de
  // referência, deixando claro que é estimativa. As proporções ficam
  // editáveis em Ajustes, porque variam por carta e por época.

  function baseDeReferencia(carta, achado, cfg) {
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

  function blocoEstados(carta, achado, cfg) {
    const caixa = document.createElement('div');
    caixa.className = 'estados';

    const base = baseDeReferencia(carta, achado, cfg);
    if (!base) {
      caixa.innerHTML = '<p class="ajuda">Sem preço de referência para estimar os estados.</p>';
      return caixa;
    }

    const titulo = document.createElement('div');
    titulo.className = 'estados-titulo';
    titulo.textContent = 'Preço por estado (estimativa)';
    caixa.appendChild(titulo);

    Store.ESTADOS.forEach(function (e) {
      const fator = cfg.estados[e.sigla];
      const linha = document.createElement('div');
      linha.className = 'estado-linha' + (e.sigla === 'NM' ? ' referencia' : '');
      linha.innerHTML =
        '<span class="sigla">' + e.sigla + '</span>' +
        '<span class="descricao">' + e.nome + '</span>' +
        '<span class="valor">' + (brl(base.valor * fator) || '—') + '</span>';
      caixa.appendChild(linha);
    });

    const nota = document.createElement('p');
    nota.className = 'ajuda';
    nota.textContent = 'Calculado sobre o ' + base.texto + ' (' + brl(base.valor) + '), ' +
      'tratado como NM. A Liga não publica o preço por estado de forma legível, ' +
      'então isto é referência de mercado — ajuste as proporções em Ajustes.';
    caixa.appendChild(nota);

    return caixa;
  }

  async function abrirDetalhe(carta) {
    const cfg = Store.config();
    const alvo = $('modal-conteudo');
    $('modal').classList.remove('oculto');

    // Carta vinda da busca por nome chega enxuta: sem preço, raridade nem
    // artista. Completa agora, que é quando esses dados vão aparecer.
    if (!carta.completa && carta.id) {
      try {
        const cheia = await Api.detalhar(carta.id);
        if (cheia) carta = Object.assign(carta, cheia);
      } catch (e) { /* mostra o que tem */ }
    }

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
    } else if (r.indisponivel || r.erro) {
      const p = document.createElement('p');
      p.className = 'ajuda';
      // Dois problemas diferentes, que confundem se forem descritos igual:
      // não existe servidor, ou existe mas a Liga recusou o pedido dele.
      p.textContent = /403|502|respondeu/.test(String(r.erro || ''))
        ? 'A LigaPokémon está recusando o pedido do servidor do site (ela usa Cloudflare, ' +
          'que barra endereços de nuvem). Use o link abaixo para ver o preço em reais direto no site deles.'
        : 'O preço da LigaPokémon precisa do servidor do site. Publique no Netlify ou rode com "npm start".';
      precos.appendChild(p);
    } else {
      const p = document.createElement('p');
      p.className = 'ajuda';
      p.textContent = r.achado
        ? 'A LigaPokémon tem essa carta cadastrada, mas ninguém está vendendo agora.'
        : 'Sem anúncio dessa carta na LigaPokémon agora.';
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

    // Estimativa por estado de conservação.
    precos.appendChild(blocoEstados(carta, r.achado, cfg));

    // O link vai sempre, tenha anúncio ou não — é assim que dá para conferir a
    // carta na Liga mesmo quando ninguém está vendendo.
    const destino = (r.achado && r.achado.url) || r.urlBusca;
    if (destino) {
      const a = document.createElement('a');
      a.className = 'link-liga';
      a.href = destino;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = (r.achado && r.achado.precoMin != null)
        ? 'Ver anúncios na LigaPokémon →'
        : 'Abrir essa carta na LigaPokémon →';
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

  const DICAS = {
    numero: 'Encha a tarja branca com o número do rodapé (ex.: 125/197). Quanto maior o número aparecer, melhor.',
    carta: 'Encaixe a carta inteira na moldura. Só funciona bem se a câmera for boa — na dúvida, use "Só o número".',
  };

  function mostrarDica() {
    const m = Scanner.modoAtual();
    const el = $('dica-modo');
    el.textContent = DICAS[m];
    el.hidden = false;
  }

  $('btn-camera').addEventListener('click', async function () {
    try {
      status(elStatus, 'Pedindo acesso à câmera…');
      const info = await Scanner.ligar($('video'), $('guia'), $('camera-caixa'));
      $('camera-vazia').classList.add('oculto');
      $('barra-camera').hidden = false;
      $('modos').hidden = false;
      $('btn-lanterna').hidden = !info.temLanterna;
      mostrarDica();

      if (info.temZoom && info.zoom) {
        const z = $('in-zoom');
        z.min = info.zoom.min;
        z.max = info.zoom.max;
        z.step = (info.zoom.max - info.zoom.min) / 20;
        z.value = info.zoom.atual;
        $('linha-zoom').hidden = false;
      }

      const r = info.resolucao;
      status(elStatus, r ? 'Câmera em ' + r.w + '×' + r.h + '. ' + DICAS[Scanner.modoAtual()] : '');
    } catch (e) {
      status(elStatus, e.message || String(e), 'erro');
    }
  });

  $('btn-parar').addEventListener('click', function () {
    Scanner.desligar();
    $('camera-vazia').classList.remove('oculto');
    $('barra-camera').hidden = true;
    $('modos').hidden = true;
    $('linha-zoom').hidden = true;
    $('dica-modo').hidden = true;
    status(elStatus, '');
  });

  document.querySelectorAll('.modo').forEach(function (b) {
    b.addEventListener('click', function () {
      Scanner.definirModo(b.dataset.modo);
      document.querySelectorAll('.modo').forEach(function (o) {
        o.classList.toggle('ativo', o === b);
      });
      mostrarDica();
    });
  });

  $('in-zoom').addEventListener('input', function () {
    Scanner.definirZoom($('in-zoom').value);
  });

  $('btn-lanterna').addEventListener('click', async function () {
    const ligada = await Scanner.alternarLanterna();
    $('btn-lanterna').classList.toggle('ativo', ligada);
  });

  $('btn-capturar').addEventListener('click', async function () {
    const btn = $('btn-capturar');
    btn.disabled = true;
    try {
      const captura = Scanner.capturar();
      await analisar(captura);
    } catch (e) {
      status(elStatus, e.message || String(e), 'erro');
    } finally {
      btn.disabled = false;
      progresso(null);
    }
  });

  // --- foto tirada pelo app de câmera do celular --------------------------
  //
  // A câmera nativa tira foto em resolução muito maior que o vídeo e com foco
  // melhor. Vale como saída quando o modo ao vivo não consegue ler.

  $('btn-foto').addEventListener('click', function () { $('in-foto').click(); });

  $('in-foto').addEventListener('change', async function (e) {
    const arquivo = e.target.files && e.target.files[0];
    if (!arquivo) return;
    e.target.value = '';

    status(elStatus, 'Abrindo a foto…');
    try {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.src = url;
      await img.decode();
      URL.revokeObjectURL(url);

      const captura = Scanner.daImagem(img);
      await analisar(captura);
    } catch (err) {
      status(elStatus, 'Não consegui abrir essa foto: ' + (err.message || err), 'erro');
    } finally {
      progresso(null);
    }
  });

  // --- diagnóstico ---------------------------------------------------------
  //
  // Quando a leitura falha, é impossível adivinhar o motivo sem ver o que o
  // OCR recebeu. Este painel mostra exatamente isso.

  function mostrarDiagnostico(leitura, captura) {
    const d = $('diagnostico');
    d.classList.remove('oculto');
    const r = captura.resolucao;
    $('diag-resumo').textContent =
      'Imagem de ' + r.w + '×' + r.h + ' · ' + leitura.leituras + ' leitura(s) · ' +
      'candidatos: ' + (leitura.candidatos.slice(0, 5).map(function (c) {
        return c.num + '/' + c.total;
      }).join(', ') || 'nenhum');
    $('diag-texto').textContent = 'Texto lido: ' + (leitura.texto || '(nada)');
    if (leitura.recorteVisto) $('diag-imagem').src = leitura.recorteVisto;
  }

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

  async function analisar(captura) {
    const cfg = Store.config();

    status(elStatus, 'Preparando o leitor…');
    progresso(0.05);
    await Ocr.preparar(function (etapa, fracao) {
      if (etapa && etapa.indexOf('load') !== -1) {
        status(elStatus, 'Baixando o leitor de texto (só na primeira vez)…');
        progresso(0.05 + fracao * 0.30);
      }
    });

    status(elStatus, 'Lendo o número…');
    const faixas = captura.faixas || captura.numero;
    const leitura = await Ocr.lerNumero(captura.quadro, faixas, function (f) {
      progresso(0.35 + f * 0.30);
    });

    mostrarDiagnostico(leitura, captura);

    if (!leitura.candidatos.length) {
      status(elStatus,
        'Não consegui ler o número. Abra "Ver o que a câmera leu" logo abaixo: se o recorte não mostrar ' +
        'o número grande e nítido, aproxime mais ou use o zoom. Também dá para digitar na mão.', 'erro');
      desenharResultados($('resultado-scan'), [], '');
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

    // Consultar o banco custa ~200ms, então dá para testar os candidatos em
    // paralelo em vez de um a um. Vence o de melhor posição que existir.
    const tentar = candidatos.slice(0, 6);
    status(elStatus, 'Conferindo ' + tentar.map(function (c) {
      return c.num + '/' + c.total;
    }).slice(0, 3).join(', ') + '…');

    const respostas = await Promise.all(tentar.map(function (c) {
      return Api.identificarPorNumero(c.num, c.total, '')
        .then(function (r) { return { c: c, cartas: r.cartas || [] }; })
        .catch(function () { return { c: c, cartas: [] }; });
    }));

    const comCartas = respostas.filter(function (r) { return r.cartas.length; });

    // Reúne tudo que o número achou.
    let opcoes = [];
    comCartas.forEach(function (r) {
      r.cartas.forEach(function (c) { opcoes.push({ carta: c, lido: r.c, via: 'numero' }); });
    });

    // --- conferência pelo nome --------------------------------------------
    //
    // Só o número não basta. Se o OCR perder um dígito e ler "25/197" em vez
    // de "125/197", as duas cartas existem, e o app entregaria a errada com
    // toda a confiança. O nome resolve isso de duas formas: descarta a carta
    // errada e, melhor ainda, encontra a certa — uma busca por "harizard"
    // filtrada pelos totais lidos chega em Charizard ex 125/197.

    let nomeLido = '';
    if (cfg.lerNome && captura.nome) {
      status(elStatus, 'Conferindo pelo nome da carta…');
      progresso(0.82);
      try {
        nomeLido = (await Ocr.lerNome(captura.quadro, captura.nome)).texto || '';
      } catch (e) { /* segue só com o número */ }
    }

    const pedaco = pedacoDeNome(nomeLido);
    if (pedaco) {
      const totaisLidos = {};
      tentar.forEach(function (c) { totaisLidos[c.total] = true; });
      try {
        const porNome = await Api.buscarPorNome(pedaco, 60);
        (porNome.cartas || []).forEach(function (c) {
          if (!totaisLidos[c.total]) return;
          if (opcoes.some(function (o) { return o.carta.id === c.id; })) return;
          opcoes.push({ carta: c, lido: { num: c.num, total: c.total }, via: 'nome' });
        });
      } catch (e) { /* sem essa ajuda, segue com o número */ }
    }

    if (!opcoes.length) {
      const tentados = tentar.slice(0, 3)
        .map(function (c) { return c.num + '/' + c.total; }).join(', ');
      status(elStatus,
        'Li algo parecido com ' + tentados + ', mas nenhuma dessas cartas existe na base. ' +
        'Veja o recorte em "Ver o que a câmera leu" — provavelmente saiu pequeno ou borrado.', 'erro');
      desenharResultados($('resultado-scan'), [], '');
      return;
    }

    const numsLidos = tentar.map(function (c) { return c.num; });
    const filtrou = pedaco ? ordenarOpcoes(opcoes, nomeLido, numsLidos) : false;
    let cartas = opcoes.map(function (o) { return o.carta; });
    const escolhida = cartas.length === 1 ? cartas[0] : null;
    const lido = opcoes[0].lido;

    progresso(1);
    ultimaLista = cartas;

    if (cartas.length === 1) {
      const c = cartas[0];
      status(elStatus,
        'Achei: ' + c.nome + ' — ' + c.set + ' (' + c.num + '/' + c.total + ')' +
        (filtrou ? ', conferido pelo nome.' : '.') +
        (!pedaco ? ' Não consegui ler o nome, então confira se é essa mesmo.' : ''),
        'bom');
    } else if (filtrou) {
      status(elStatus, 'O nome bate com ' + cartas.length + ' cartas (mesma carta em artes ' +
        'diferentes). A primeira é a mais provável — confira o número no rodapé:', 'bom');
    } else {
      status(elStatus, 'Achei ' + cartas.length + ' possibilidades para ' +
        lido.num + '/' + lido.total + '. Escolha a certa:', 'bom');
    }

    desenharResultados($('resultado-scan'), cartas, '');
    if (cartas.length === 1) abrirDetalhe(cartas[0]);
  }

  // Reordena as opções no lugar, usando o nome lido e o número lido, e joga
  // fora o que o nome contradiz. Devolve true se conseguiu filtrar por nome.
  //
  // Por que o número entra como segundo critério: uma carta como "Charizard ex"
  // aparece 4 vezes na mesma coleção (artes alternativas), com nomes idênticos.
  // O nome empata, então quem desempata é a semelhança do número — se o OCR
  // leu "25", o 125 é bem mais provável que o 228, porque "25" termina o 125.
  function ordenarOpcoes(opcoes, nomeLido, numsLidos) {
    const lido = soLetras(nomeLido);

    opcoes.forEach(function (o) {
      const nome = soLetras(o.carta.nome);
      o.notaNome = nome ? maiorTrechoComum(lido, nome) / nome.length : 0;
      o.notaNum = 0;
      const num = String(o.carta.num || '');
      numsLidos.forEach(function (n) {
        if (!n) return;
        if (num === n) o.notaNum = Math.max(o.notaNum, 3);
        else if (num.length > n.length && num.slice(-n.length) === n) o.notaNum = Math.max(o.notaNum, 2);
        else if (num.indexOf(n) !== -1) o.notaNum = Math.max(o.notaNum, 1);
      });
    });

    // "Raichu" e "Pikachu" dividem o trecho "chu", então um corte fixo deixa
    // os dois passarem. O corte também é relativo ao melhor: quem ficou bem
    // atrás do primeiro colocado sai.
    const melhorNota = opcoes.reduce(function (m, o) { return Math.max(m, o.notaNome); }, 0);
    const corte = Math.max(0.5, melhorNota - 0.2);
    const bons = opcoes.filter(function (o) { return o.notaNome >= corte; });
    const usar = bons.length ? bons : opcoes;

    // O nome manda. O número só desempata entre nomes praticamente iguais —
    // é o caso das artes alternativas, que têm o mesmo nome e números
    // diferentes.
    usar.sort(function (a, b) {
      const dif = b.notaNome - a.notaNome;
      if (Math.abs(dif) > 0.12) return dif;
      if (b.notaNum !== a.notaNum) return b.notaNum - a.notaNum;
      return dif;
    });

    // Cópia antes de esvaziar: quando não há nome bom, `usar` É o próprio
    // `opcoes`, e limpar um limparia o outro.
    const ordenadas = usar.slice();
    opcoes.length = 0;
    ordenadas.forEach(function (o) { opcoes.push(o); });

    // true = o nome foi útil, dá para confiar mais no resultado.
    return bons.length > 0;
  }

  // Tira do texto sujo do OCR um pedaço que sirva de busca. A busca da base é
  // por substring, então "harizard" já encontra Charizard.
  const RUIDO = ['stage', 'basic', 'evolves', 'from', 'illus', 'pokemon', 'trainer',
    'energy', 'ability', 'rule', 'when', 'your', 'this'];

  function pedacoDeNome(texto) {
    const palavras = String(texto || '').toLowerCase().match(/[a-z]{4,}/g) || [];
    const uteis = palavras.filter(function (p) { return RUIDO.indexOf(p) === -1; });
    if (!uteis.length) return '';
    return uteis.sort(function (a, b) { return b.length - a.length; })[0];
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
