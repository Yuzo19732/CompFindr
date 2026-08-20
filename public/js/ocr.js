/* ==========================================================================
   ocr.js — leitura do texto da carta
   --------------------------------------------------------------------------
   Não existe API gratuita e confiável de "buscar carta por imagem". O que
   funciona é ler o texto impresso com OCR (Tesseract, rodando no próprio
   navegador) e usar isso como chave de busca.

   O alvo é o número do rodapé — "125/197". Ele identifica a carta quase
   sozinho: o total (197) diz qual é a coleção, o número (125) diz qual carta
   dentro dela.

   Três decisões vieram de teste com cartas reais:

   1. O modo de página importa. PSM 7 ("uma linha") falha, porque o rodapé tem
      duas linhas. PSM 6 ("bloco de texto") acerta.

   2. Inverter a imagem não muda nada — o Tesseract já lida com texto claro em
      fundo escuro. O que muda o resultado é o LIMIAR entre preto e branco, e
      ele precisa variar: carta comum e carta full-art pedem cortes diferentes.

   3. O traço "/" sai errado com frequência: 161/131 vira "1617131". Por isso
      não confiamos numa leitura só. Montamos uma lista de CANDIDATOS e quem
      decide qual existe de verdade é o banco de cartas.
   ========================================================================== */

const Ocr = (function () {

  let worker = null;
  let modoAtual = '';
  let iniciando = null;

  const PASSADAS = [
    { limiar: 0.92, alturaAlvo: 420 },
    { limiar: 1.10, alturaAlvo: 620 },
    { limiar: 0.75, alturaAlvo: 420 },
    { limiar: 0.98, alturaAlvo: 700 },
  ];

  const MAX_LEITURAS = 6; // teto de chamadas ao OCR, para não travar o celular

  // --- preparo do motor ----------------------------------------------------

  async function preparar(aoProgredir) {
    if (worker) return worker;
    if (iniciando) return iniciando;

    if (typeof Tesseract === 'undefined') {
      throw new Error('O motor de leitura não carregou. Verifique a conexão e recarregue a página.');
    }

    iniciando = (async function () {
      worker = await Tesseract.createWorker('eng', 1, {
        logger: function (m) {
          if (aoProgredir && m && typeof m.progress === 'number') {
            aoProgredir(m.status, m.progress);
          }
        },
      });
      return worker;
    })();

    try {
      return await iniciando;
    } finally {
      iniciando = null;
    }
  }

  async function usarModo(modo) {
    if (modoAtual === modo) return;
    if (modo === 'numero') {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789/',
        tessedit_pageseg_mode: '6',
      });
    } else {
      await worker.setParameters({
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' .-",
        tessedit_pageseg_mode: '7',
      });
    }
    modoAtual = modo;
  }

  // --- tratamento da imagem ------------------------------------------------

  // Recorta um pedaço, amplia até a altura pedida e joga para preto e branco.
  // A altura fixa (em vez de "multiplique por 4") mantém o texto sempre do
  // mesmo tamanho, seja numa câmera de 720p ou de 4K.
  function tratar(origem, recorte, alturaAlvo, fatorLimiar) {
    const escala = Math.min(10, Math.max(1, alturaAlvo / recorte.h));
    const largura = Math.max(1, Math.round(recorte.w * escala));
    const altura = Math.max(1, Math.round(recorte.h * escala));

    const c = document.createElement('canvas');
    c.width = largura;
    c.height = altura;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(origem, recorte.x, recorte.y, recorte.w, recorte.h, 0, 0, largura, altura);

    const img = ctx.getImageData(0, 0, largura, altura);
    const d = img.data;

    let soma = 0;
    for (let i = 0; i < d.length; i += 4) {
      const cinza = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = cinza;
      soma += cinza;
    }

    const corte = (soma / (d.length / 4)) * fatorLimiar;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] < corte ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }

    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Versão pequena da imagem tratada, para mostrar na tela o que o OCR viu.
  function miniatura(canvas, larguraMax) {
    const alvo = larguraMax || 560;
    if (canvas.width <= alvo) return canvas.toDataURL('image/png');
    const c = document.createElement('canvas');
    c.width = alvo;
    c.height = Math.max(1, Math.round(canvas.height * alvo / canvas.width));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  // --- candidatos ----------------------------------------------------------

  function valido(num, total) {
    const n = parseInt(num, 10);
    const t = parseInt(total, 10);
    if (!Number.isFinite(n) || !Number.isFinite(t)) return false;
    if (n < 1 || n > 999) return false;
    if (t < 1 || t > 999) return false;
    return true;
  }

  function anoProvavel(digitos) {
    return /^(19|20)\d\d$/.test(digitos);
  }

  // De um texto sujo de OCR, tira todas as leituras plausíveis de "num/total",
  // da mais confiável para a menos.
  function candidatos(texto) {
    const t = String(texto || '');
    const achados = [];

    function juntar(num, total, prioridade) {
      if (!valido(num, total)) return;
      achados.push({
        num: String(parseInt(num, 10)),
        total: String(parseInt(total, 10)),
        prioridade: prioridade,
      });
    }

    let m;

    // 1) "125/197" — traço lido certo, sem espaço no meio.
    const estrito = /(\d{1,3})\/(\d{1,3})/g;
    while ((m = estrito.exec(t)) !== null) juntar(m[1], m[2], 1);

    // 2) "125 / 197" — com espaço, mas na mesma linha.
    const comEspaco = /(\d{1,3})[ ]{0,2}\/[ ]{0,2}(\d{1,3})/g;
    while ((m = comEspaco.exec(t)) !== null) juntar(m[1], m[2], 2);

    // 3) O traço virou dígito. "1617131" é, na verdade, 161/131.
    const corridas = t.match(/\d+/g) || [];
    for (let i = 0; i < corridas.length; i++) {
      // Tira o ano do rodapé de copyright ("©2025 Pokémon"), senão ele vira
      // candidato falso 20/25 em toda leitura.
      const d = corridas[i].replace(/(19|20)\d\d/g, '');
      if (!d || anoProvavel(d)) continue;

      if (d.length === 7) juntar(d.slice(0, 3), d.slice(4), 3);
      if (d.length === 6) juntar(d.slice(0, 3), d.slice(3), 4);
      if (d.length === 5) {
        juntar(d.slice(0, 2), d.slice(2), 4);
        juntar(d.slice(0, 3), d.slice(3), 5);
      }
      if (d.length === 4) juntar(d.slice(0, 2), d.slice(2), 6);

      // Sobrou dígito grudado nas pontas ("11617131"): tenta cada janela de 7.
      if (d.length > 7 && d.length <= 10) {
        for (let j = 0; j + 7 <= d.length; j++) {
          const janela = d.substr(j, 7);
          juntar(janela.slice(0, 3), janela.slice(4), 5);
        }
      }
    }

    return achados;
  }

  // Junta os candidatos de todas as leituras e ordena. Padrão confiável vem
  // antes de leitura repetida: um "125/197" lido uma vez vale mais que um
  // palpite de recorte que apareceu três vezes.
  function ranquear(listas) {
    const contagem = new Map();
    listas.forEach(function (lista) {
      const nesta = new Set();
      lista.forEach(function (c) {
        const k = c.num + '/' + c.total;
        const atual = contagem.get(k) || { num: c.num, total: c.total, votos: 0, prioridade: 9 };
        if (!nesta.has(k)) { atual.votos++; nesta.add(k); }
        atual.prioridade = Math.min(atual.prioridade, c.prioridade);
        contagem.set(k, atual);
      });
    });

    return Array.from(contagem.values()).sort(function (a, b) {
      if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
      return b.votos - a.votos;
    });
  }

  // --- leitura do número ---------------------------------------------------

  // `recortes` pode ser um recorte só ou uma lista deles (o caso da foto, em
  // que não se sabe onde a carta está). Roda em largura primeiro: testa todas
  // as faixas com o melhor limiar antes de insistir com limiares piores.
  async function lerNumero(origem, recortes, aoAndar) {
    await usarModo('numero');

    const faixas = Array.isArray(recortes) ? recortes : [recortes];
    const listas = [];
    const textos = [];
    let leituras = 0;
    let primeiraImagem = null;

    for (let p = 0; p < PASSADAS.length; p++) {
      for (let f = 0; f < faixas.length; f++) {
        if (leituras >= MAX_LEITURAS) break;

        const imagem = tratar(origem, faixas[f], PASSADAS[p].alturaAlvo, PASSADAS[p].limiar);
        if (!primeiraImagem) primeiraImagem = imagem;

        const r = await worker.recognize(imagem);
        leituras++;
        if (aoAndar) aoAndar(leituras / MAX_LEITURAS);

        const texto = (r.data.text || '').trim();
        if (texto) textos.push(texto.replace(/\s+/g, ' '));
        listas.push(candidatos(texto));
      }

      // Achou leitura no padrão bom? Não precisa insistir: consultar o banco
      // de cartas custa ~200ms, é mais rápido que outra passada de OCR.
      const parcial = ranquear(listas);
      if (parcial.length && parcial[0].prioridade <= 2) {
        return montar(parcial, textos, primeiraImagem, leituras);
      }
      if (leituras >= MAX_LEITURAS) break;
    }

    return montar(ranquear(listas), textos, primeiraImagem, leituras);
  }

  function montar(cands, textos, imagem, leituras) {
    return {
      candidatos: cands,
      texto: textos.join(' | '),
      leituras: leituras,
      recorteVisto: imagem ? miniatura(imagem) : null,
    };
  }

  // --- leitura do nome -----------------------------------------------------

  // Devolve o texto cru, sem tentar "consertar". A leitura sai suja por causa
  // do selo de estágio e do fundo da arte ("jiF Pikachy"); quem compara isso
  // com os nomes candidatos é o app, por semelhança.
  async function lerNome(origem, recortes) {
    if (!recortes) return { texto: '' };
    await usarModo('nome');

    const faixas = Array.isArray(recortes) ? recortes : [recortes];
    const partes = [];

    // Duas tentativas quando há uma faixa só; uma tentativa por faixa quando
    // não se sabe onde a carta está (caso da foto).
    const limiares = faixas.length > 1 ? [PASSADAS[0].limiar] : [PASSADAS[0].limiar, PASSADAS[1].limiar];

    for (let f = 0; f < faixas.length; f++) {
      for (let i = 0; i < limiares.length; i++) {
        const imagem = tratar(origem, faixas[f], 340, limiares[i]);
        const r = await worker.recognize(imagem);
        const bruto = (r.data.text || '').replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (bruto) partes.push(bruto);
      }
    }
    return { texto: partes.join(' ') };
  }

  async function encerrar() {
    if (worker) {
      try { await worker.terminate(); } catch (e) { /* já morreu */ }
      worker = null;
      modoAtual = '';
    }
  }

  return {
    preparar: preparar,
    lerNumero: lerNumero,
    lerNome: lerNome,
    candidatos: candidatos,
    encerrar: encerrar,
    pronto: function () { return !!worker; },
  };
})();
