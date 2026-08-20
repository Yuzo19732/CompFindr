/* ==========================================================================
   ocr.js — leitura do texto da carta
   --------------------------------------------------------------------------
   Não existe API gratuita e confiável de "buscar carta por imagem". O que
   funciona bem é ler o texto impresso com OCR (Tesseract, rodando dentro do
   próprio navegador) e usar isso como chave de busca.

   O alvo é o número do rodapé — "125/197". Ele identifica a carta quase
   sozinho: o total (197) diz qual é a coleção, o número (125) diz qual carta
   dentro dela.

   Duas decisões vieram de teste com cartas reais:

   1. O OCR erra o traço "/" com frequência em cartas full-art, lendo "7"
      ou "1". Por isso não confiamos numa leitura única: geramos uma lista de
      CANDIDATOS e deixamos o banco de dados dizer qual existe de verdade.
      "1617131" vira o candidato 161/131, que a base confirma ser o Umbreon.

   2. O modo de página importa muito. PSM 7 ("uma linha") falha, porque o
      rodapé tem duas linhas. PSM 6 ("bloco de texto") acerta.
   ========================================================================== */

const Ocr = (function () {

  let worker = null;
  let modoAtual = '';
  let iniciando = null;

  // Tentativas, em ordem, testadas contra cartas comuns, holo e full-art.
  // O que muda o resultado é o LIMIAR (o ponto de corte entre preto e branco)
  // e o tamanho — inverter a imagem não muda nada, porque o Tesseract já lida
  // bem com texto claro em fundo escuro.
  //
  // `alturaAlvo` é a altura em pixels para a qual a faixa é ampliada. Usar
  // altura fixa em vez de "multiplique por 4" mantém o texto sempre do mesmo
  // tamanho, seja numa câmera de 720p ou de 4K.
  const PASSADAS = [
    { limiar: 0.92, alturaAlvo: 400 },
    { limiar: 1.10, alturaAlvo: 600 },
    { limiar: 0.75, alturaAlvo: 400 },
    { limiar: 0.95, alturaAlvo: 600 },
  ];

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
        tessedit_pageseg_mode: '6', // bloco de texto: o rodapé tem mais de uma linha
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
  function tratar(origem, recorte, alturaAlvo, fatorLimiar) {
    const escala = Math.min(8, Math.max(1, alturaAlvo / recorte.h));
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
  // da mais confiável para a menos. Quem decide qual é a certa é a base de
  // cartas: basta consultar cada uma até uma existir.
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

    // 1) "125/197" — traço lido corretamente, sem espaço no meio.
    let m;
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

  // Junta os candidatos das várias tentativas e ordena por: quantas vezes
  // apareceu, depois pela confiabilidade do padrão que o gerou.
  function ranquear(listas) {
    const contagem = new Map();
    listas.forEach(function (lista) {
      const vistosNestaPassada = new Set();
      lista.forEach(function (c) {
        const k = c.num + '/' + c.total;
        const atual = contagem.get(k) || { num: c.num, total: c.total, votos: 0, prioridade: 9 };
        if (!vistosNestaPassada.has(k)) { atual.votos++; vistosNestaPassada.add(k); }
        atual.prioridade = Math.min(atual.prioridade, c.prioridade);
        contagem.set(k, atual);
      });
    });

    // Padrão confiável vem antes de leitura repetida: um "125/197" lido uma
    // vez vale mais que um palpite de recorte que apareceu três vezes.
    return Array.from(contagem.values()).sort(function (a, b) {
      if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
      return b.votos - a.votos;
    });
  }

  // --- leitura do número ---------------------------------------------------

  async function lerNumero(origem, recorte, aoAndar) {
    await usarModo('numero');

    const listas = [];
    let textoBruto = '';

    for (let i = 0; i < PASSADAS.length; i++) {
      if (aoAndar) aoAndar(i / PASSADAS.length);
      const p = PASSADAS[i];
      const imagem = tratar(origem, recorte, p.alturaAlvo, p.limiar);
      const r = await worker.recognize(imagem);
      const texto = (r.data.text || '').trim();
      if (texto) textoBruto += (textoBruto ? ' | ' : '') + texto.replace(/\s+/g, ' ');

      listas.push(candidatos(texto));

      // Leitura consistente duas vezes seguidas: não precisa gastar mais tempo.
      if (i >= 1) {
        const parcial = ranquear(listas);
        if (parcial.length && parcial[0].votos >= 2 && parcial[0].prioridade <= 3) {
          return { candidatos: parcial, texto: textoBruto, passadas: i + 1 };
        }
      }
    }

    return { candidatos: ranquear(listas), texto: textoBruto, passadas: PASSADAS.length };
  }

  // --- leitura do nome -----------------------------------------------------

  // Devolve o texto cru, sem tentar "consertar". A leitura do nome sai suja
  // ("jiF Pikachy", "Fag harizard Ao") por causa do selo de estágio e do
  // fundo da arte. Quem compara isso com os nomes candidatos é o app, por
  // semelhança — exigir leitura perfeita aqui só jogaria fora informação boa.
  async function lerNome(origem, recorte) {
    await usarModo('nome');

    const partes = [];
    for (let i = 0; i < 2; i++) {
      const imagem = tratar(origem, recorte, 320, PASSADAS[i].limiar);
      const r = await worker.recognize(imagem);
      const bruto = (r.data.text || '').replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (bruto) partes.push(bruto);
    }
    return { texto: partes.join(' '), passadas: partes.length };
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
