/* ==========================================================================
   scanner.js — câmera, enquadramento e recorte
   --------------------------------------------------------------------------
   Cuida de ligar a câmera, desenhar a moldura por cima do vídeo e entregar ao
   OCR o pedaço exato que interessa.

   Por que a resolução importa tanto (medido em 2026-08-20):
   o número do rodapé tem cerca de 1,7% da altura da carta. Se a carta ocupa
   1000px na imagem, o número tem 17px de altura — o OCR erra quase sempre.
   Com 2000px de carta, ele acerta mesmo com a foto um pouco desfocada.
   Daí duas decisões:

     1. Pedir à câmera a MAIOR resolução que ela aceitar, não 1080p.
     2. Ter um modo "só o número", em que a moldura é uma tarja pequena e a
        pessoa aponta para o número. Aí o número ocupa a imagem inteira e a
        leitura fica fácil, mesmo em câmera fraca.

   O vídeo aparece com `object-fit: contain`, então sobram barras pretas nas
   laterais. As contas em paraTela() convertem coordenadas do vídeo para a
   posição na tela — sem isso a moldura fica fora de lugar.
   ========================================================================== */

const Scanner = (function () {

  const PROPORCAO_CARTA = 63 / 88; // largura/altura de uma carta Pokémon

  let stream = null;
  let trilha = null;
  let video = null;
  let elGuia = null;
  let caixa = null;
  let lanternaLigada = false;
  let modo = 'numero';           // 'numero' (tarja) ou 'carta' (moldura inteira)
  let capacidades = null;

  function suportado() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function contextoSeguro() {
    return window.isSecureContext === true;
  }

  function definirModo(novo) {
    modo = novo === 'carta' ? 'carta' : 'numero';
    posicionarGuia();
    return modo;
  }

  function modoAtual() { return modo; }

  // --- ligar / desligar ----------------------------------------------------

  async function ligar(elVideo, elMolde, elCaixa) {
    video = elVideo;
    elGuia = elMolde;
    caixa = elCaixa;

    if (!suportado()) {
      throw new Error(
        contextoSeguro()
          ? 'Este navegador não expõe a câmera.'
          : 'A câmera só funciona em HTTPS. Abra o site pelo endereço https:// (o Netlify já entrega assim).'
      );
    }

    // Pede 4K. O navegador entrega o mais próximo que a câmera tiver — é só
    // uma preferência, não trava se o aparelho não suportar.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    });

    trilha = stream.getVideoTracks()[0];
    capacidades = trilha.getCapabilities ? trilha.getCapabilities() : null;

    // Alguns aparelhos ignoram o "ideal" e entregam 640x480. Se a câmera
    // suporta mais, insiste no máximo dela.
    if (capacidades && capacidades.width && capacidades.width.max) {
      const atual = trilha.getSettings ? (trilha.getSettings().width || 0) : 0;
      if (capacidades.width.max > atual) {
        try {
          await trilha.applyConstraints({
            width: capacidades.width.max,
            height: capacidades.height ? capacidades.height.max : undefined,
          });
        } catch (e) { /* fica com o que veio */ }
      }
    }

    // Foco contínuo ajuda muito num alvo pequeno como o número.
    if (capacidades && capacidades.focusMode && capacidades.focusMode.indexOf('continuous') !== -1) {
      try { await trilha.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* ok */ }
    }

    video.srcObject = stream;
    await video.play();

    if (!video.videoWidth) {
      await new Promise(function (ok) {
        video.addEventListener('loadedmetadata', ok, { once: true });
      });
    }

    video.classList.add('ligado');
    elGuia.hidden = false;
    posicionarGuia();

    window.addEventListener('resize', posicionarGuia);
    window.addEventListener('orientationchange', posicionarGuia);

    return {
      temLanterna: temLanterna(),
      temZoom: temZoom(),
      zoom: temZoom() ? { min: capacidades.zoom.min, max: capacidades.zoom.max, atual: valorZoom() } : null,
      resolucao: resolucao(),
    };
  }

  function desligar() {
    window.removeEventListener('resize', posicionarGuia);
    window.removeEventListener('orientationchange', posicionarGuia);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    trilha = null;
    capacidades = null;
    lanternaLigada = false;
    if (video) { video.srcObject = null; video.classList.remove('ligado'); }
    if (elGuia) elGuia.hidden = true;
  }

  function ligada() { return !!stream; }

  function resolucao() {
    if (!video || !video.videoWidth) return null;
    return { w: video.videoWidth, h: video.videoHeight };
  }

  // --- lanterna e zoom -----------------------------------------------------

  function temLanterna() {
    return !!(capacidades && capacidades.torch);
  }

  async function alternarLanterna() {
    if (!temLanterna()) return false;
    lanternaLigada = !lanternaLigada;
    try {
      await trilha.applyConstraints({ advanced: [{ torch: lanternaLigada }] });
    } catch (e) {
      lanternaLigada = false;
    }
    return lanternaLigada;
  }

  // O zoom da própria câmera vale ouro aqui: dá para ficar longe o bastante
  // para o foco funcionar e ainda assim encher a tarja com o número.
  function temZoom() {
    return !!(capacidades && capacidades.zoom && capacidades.zoom.max > capacidades.zoom.min);
  }

  function valorZoom() {
    if (!trilha || !trilha.getSettings) return 1;
    return trilha.getSettings().zoom || 1;
  }

  async function definirZoom(v) {
    if (!temZoom()) return null;
    try {
      await trilha.applyConstraints({ advanced: [{ zoom: Number(v) }] });
      return valorZoom();
    } catch (e) {
      return null;
    }
  }

  // --- geometria -----------------------------------------------------------

  function calcularRecortes() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    if (modo === 'numero') {
      // Tarja larga e baixa, no meio da tela. A pessoa encosta nela o número
      // do rodapé; ele passa a ocupar a imagem quase inteira.
      const w = vw * 0.72;
      const h = w * 0.16;
      const x = (vw - w) / 2;
      const y = (vh - h) / 2;
      return {
        video: { w: vw, h: vh },
        modo: 'numero',
        carta: { x: x, y: y, w: w, h: h },
        numero: { x: x, y: y, w: w, h: h },
        nome: null,
      };
    }

    let alturaCarta = vh * 0.86;
    let larguraCarta = alturaCarta * PROPORCAO_CARTA;
    if (larguraCarta > vw * 0.92) {
      larguraCarta = vw * 0.92;
      alturaCarta = larguraCarta / PROPORCAO_CARTA;
    }
    const x = (vw - larguraCarta) / 2;
    const y = (vh - alturaCarta) / 2;

    return {
      video: { w: vw, h: vh },
      modo: 'carta',
      carta: { x: x, y: y, w: larguraCarta, h: alturaCarta },
      // O número fica à esquerda nas cartas novas e à direita nas antigas,
      // então a faixa pega a largura toda.
      numero: {
        x: x,
        y: y + alturaCarta * 0.90,
        w: larguraCarta,
        h: alturaCarta * 0.10,
      },
      nome: {
        x: x + larguraCarta * 0.08,
        y: y + alturaCarta * 0.028,
        w: larguraCarta * 0.67,
        h: alturaCarta * 0.060,
      },
    };
  }

  // Converte coordenadas do vídeo para pixels na tela (object-fit: contain).
  function paraTela(r, info) {
    const rect = caixa.getBoundingClientRect();
    const escala = Math.min(rect.width / info.video.w, rect.height / info.video.h);
    const margemX = (rect.width - info.video.w * escala) / 2;
    const margemY = (rect.height - info.video.h * escala) / 2;
    return {
      left: margemX + r.x * escala,
      top: margemY + r.y * escala,
      width: r.w * escala,
      height: r.h * escala,
    };
  }

  function aplicar(el, css, visivel) {
    el.style.display = visivel === false ? 'none' : '';
    if (visivel === false) return;
    el.style.left = css.left + 'px';
    el.style.top = css.top + 'px';
    el.style.width = css.width + 'px';
    el.style.height = css.height + 'px';
  }

  function posicionarGuia() {
    if (!video || !elGuia || elGuia.hidden) return;
    const info = calcularRecortes();
    if (!info) return;

    const borda = elGuia.querySelector('.guia-borda');
    const faixaNum = elGuia.querySelector('.guia-faixa-num');
    const faixaNome = elGuia.querySelector('.guia-faixa-nome');

    if (info.modo === 'numero') {
      aplicar(borda, paraTela(info.carta, info));
      aplicar(faixaNum, paraTela(info.numero, info), false);
      aplicar(faixaNome, null, false);
    } else {
      aplicar(borda, paraTela(info.carta, info));
      aplicar(faixaNum, paraTela(info.numero, info));
      aplicar(faixaNome, paraTela(info.nome, info));
    }
  }

  // --- captura -------------------------------------------------------------

  // Congela o quadro atual num canvas, no tamanho real do vídeo.
  function capturar() {
    if (!ligada()) throw new Error('A câmera não está ligada.');
    const info = calcularRecortes();
    if (!info) throw new Error('A câmera ainda não entregou a imagem.');

    const c = document.getElementById('canvas-trabalho');
    c.width = info.video.w;
    c.height = info.video.h;
    c.getContext('2d').drawImage(video, 0, 0, info.video.w, info.video.h);

    return {
      quadro: c,
      modo: info.modo,
      numero: info.numero,
      nome: info.nome,
      carta: info.carta,
      resolucao: info.video,
    };
  }

  // --- foto vinda do celular ----------------------------------------------
  //
  // O app de câmera do próprio aparelho tira foto em resolução bem maior que
  // o vídeo e com foco melhor. Como não dá para saber onde a carta está na
  // foto, devolvemos várias faixas candidatas e o OCR tenta todas.

  function daImagem(img) {
    const c = document.getElementById('canvas-trabalho');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);

    const L = c.width;
    const A = c.height;

    // Se a carta preenche a foto, o número está no rodapé dela. Se sobrou
    // margem, ele está um pouco acima. As faixas cobrem os dois casos.
    const faixas = [
      { x: 0, y: A * 0.88, w: L, h: A * 0.12 },
      { x: 0, y: A * 0.82, w: L, h: A * 0.10 },
      { x: 0, y: A * 0.74, w: L, h: A * 0.10 },
    ];

    // E o caso de a carta estar centralizada com margem em volta.
    let altC = A * 0.94;
    let largC = altC * PROPORCAO_CARTA;
    if (largC > L * 0.94) { largC = L * 0.94; altC = largC / PROPORCAO_CARTA; }
    const cx = (L - largC) / 2;
    const cy = (A - altC) / 2;
    faixas.push({ x: cx, y: cy + altC * 0.89, w: largC, h: altC * 0.11 });

    // O nome fica no topo. Ele não identifica a carta sozinho, mas serve de
    // conferência: sem ele, uma leitura como "25/197" em vez de "125/197"
    // devolve outra carta com toda a confiança.
    const nomes = [
      { x: L * 0.06, y: A * 0.02, w: L * 0.70, h: A * 0.075 },
      { x: cx + largC * 0.08, y: cy + altC * 0.028, w: largC * 0.67, h: altC * 0.060 },
    ];

    return { quadro: c, modo: 'foto', faixas: faixas, nome: nomes, resolucao: { w: L, h: A } };
  }

  return {
    ligar: ligar,
    desligar: desligar,
    ligada: ligada,
    capturar: capturar,
    daImagem: daImagem,
    posicionarGuia: posicionarGuia,
    definirModo: definirModo,
    modoAtual: modoAtual,
    resolucao: resolucao,
    temLanterna: temLanterna,
    alternarLanterna: alternarLanterna,
    temZoom: temZoom,
    definirZoom: definirZoom,
    suportado: suportado,
    contextoSeguro: contextoSeguro,
  };
})();
