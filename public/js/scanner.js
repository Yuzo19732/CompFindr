/* ==========================================================================
   scanner.js — câmera e recorte
   --------------------------------------------------------------------------
   Cuida de ligar a câmera, desenhar a moldura da carta por cima do vídeo e
   entregar ao OCR exatamente os dois pedaços que interessam:

     · a faixa do rodapé  -> onde fica o número (125/197)
     · a faixa do topo    -> onde fica o nome

   Detalhe importante: o vídeo aparece com `object-fit: contain`, então sobram
   barras pretas nas laterais. As contas abaixo convertem as coordenadas reais
   do vídeo para a posição na tela, senão a moldura fica fora de lugar.
   ========================================================================== */

const Scanner = (function () {

  const PROPORCAO_CARTA = 63 / 88; // largura/altura de uma carta Pokémon

  let stream = null;
  let trilha = null;
  let video = null;
  let elGuia = null;
  let caixa = null;
  let lanternaLigada = false;

  // Onde estão as faixas, em coordenadas reais do vídeo.
  let recortes = { numero: null, nome: null, carta: null };

  function suportado() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function contextoSeguro() {
    return window.isSecureContext === true;
  }

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

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }, // câmera traseira no celular
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    trilha = stream.getVideoTracks()[0];
    video.srcObject = stream;
    await video.play();

    // Espera as dimensões reais aparecerem antes de calcular a moldura.
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

    return { temLanterna: temLanterna() };
  }

  function desligar() {
    window.removeEventListener('resize', posicionarGuia);
    window.removeEventListener('orientationchange', posicionarGuia);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    trilha = null;
    lanternaLigada = false;
    if (video) { video.srcObject = null; video.classList.remove('ligado'); }
    if (elGuia) elGuia.hidden = true;
  }

  function ligada() { return !!stream; }

  // --- lanterna ------------------------------------------------------------

  function temLanterna() {
    if (!trilha || !trilha.getCapabilities) return false;
    const cap = trilha.getCapabilities();
    return !!(cap && cap.torch);
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

  // --- geometria -----------------------------------------------------------

  function calcularRecortes() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    // A carta ocupa a maior área possível mantendo a proporção 63x88.
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
      carta: { x: x, y: y, w: larguraCarta, h: alturaCarta },
      // Rodapé inteiro: o número fica à esquerda nas cartas novas e à direita
      // nas antigas, então a faixa pega a largura toda. Os limites vieram de
      // teste com cartas reais — encolher demais corta o primeiro dígito.
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

  function aplicar(el, css) {
    el.style.left = css.left + 'px';
    el.style.top = css.top + 'px';
    el.style.width = css.width + 'px';
    el.style.height = css.height + 'px';
  }

  function posicionarGuia() {
    if (!video || !elGuia || elGuia.hidden) return;
    const info = calcularRecortes();
    if (!info) return;
    recortes = info;

    aplicar(elGuia.querySelector('.guia-borda'), paraTela(info.carta, info));
    aplicar(elGuia.querySelector('.guia-faixa-num'), paraTela(info.numero, info));
    aplicar(elGuia.querySelector('.guia-faixa-nome'), paraTela(info.nome, info));
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

    return { quadro: c, numero: info.numero, nome: info.nome, carta: info.carta };
  }

  return {
    ligar: ligar,
    desligar: desligar,
    ligada: ligada,
    capturar: capturar,
    posicionarGuia: posicionarGuia,
    temLanterna: temLanterna,
    alternarLanterna: alternarLanterna,
    suportado: suportado,
    contextoSeguro: contextoSeguro,
  };
})();
