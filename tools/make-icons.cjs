/* ==========================================================================
   make-icons.js — gera os ícones do app sem depender de biblioteca nenhuma
   --------------------------------------------------------------------------
   Desenha os pixels na mão e monta o arquivo PNG (só zlib, que já vem no
   Node). Roda no build do Netlify, então os ícones nunca ficam desatualizados
   e não precisam ser versionados como binário.
   ========================================================================== */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SAIDA = path.join(__dirname, '..', 'public', 'icons');

// --- PNG ------------------------------------------------------------------

const TABELA_CRC = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([tam, corpo, crc]);
}

function png(largura, altura, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;  // 8 bits por canal
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Cada linha leva um byte de filtro (0 = nenhum) na frente.
  const linhas = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    const destino = y * (largura * 4 + 1);
    linhas[destino] = 0;
    rgba.copy(linhas, destino + 1, y * largura * 4, (y + 1) * largura * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(linhas, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- desenho ---------------------------------------------------------------

function misturar(fundo, frente, alfa) {
  return [
    Math.round(fundo[0] * (1 - alfa) + frente[0] * alfa),
    Math.round(fundo[1] * (1 - alfa) + frente[1] * alfa),
    Math.round(fundo[2] * (1 - alfa) + frente[2] * alfa),
  ];
}

// Suaviza a borda: 0 fora, 1 dentro, meio termo na transição de 1 pixel.
function cobertura(distancia, raio) {
  const d = raio - distancia;
  if (d >= 0.5) return 1;
  if (d <= -0.5) return 0;
  return d + 0.5;
}

function desenhar(tamanho, escalaConteudo) {
  const px = Buffer.alloc(tamanho * tamanho * 4);
  const centro = tamanho / 2;
  const raioBola = (tamanho / 2) * escalaConteudo;

  const VERMELHO = [255, 84, 112];
  const BRANCO = [233, 237, 247];
  const PRETO = [10, 13, 22];
  const ROXO = [124, 92, 255];

  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      const i = (y * tamanho + x) * 4;

      // Fundo: degradê diagonal escuro.
      const t = (x / tamanho + y / tamanho) / 2;
      let cor = misturar([10, 13, 22], [27, 34, 54], t);
      let alfa = 255;

      const dx = x - centro + 0.5;
      const dy = y - centro + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Brilho roxo atrás da bola.
      const halo = cobertura(dist, raioBola * 1.22);
      if (halo > 0) cor = misturar(cor, ROXO, halo * 0.16);

      // Pokébola.
      const dentro = cobertura(dist, raioBola);
      if (dentro > 0) {
        const metade = dy < 0 ? VERMELHO : BRANCO;
        let corBola = metade;

        // Faixa central preta.
        const faixa = raioBola * 0.13;
        if (Math.abs(dy) < faixa) corBola = PRETO;

        // Botão do meio.
        const raioBotao = raioBola * 0.3;
        if (dist < raioBotao) {
          corBola = dist < raioBotao * 0.62 ? BRANCO : PRETO;
        }

        // Contorno.
        if (dist > raioBola * 0.955) corBola = PRETO;

        cor = misturar(cor, corBola, dentro);
      }

      px[i] = cor[0];
      px[i + 1] = cor[1];
      px[i + 2] = cor[2];
      px[i + 3] = alfa;
    }
  }
  return px;
}

// --- gerar -----------------------------------------------------------------

fs.mkdirSync(SAIDA, { recursive: true });

const arquivos = [
  { nome: 'icon-192.png', tamanho: 192, escala: 0.74 },
  { nome: 'icon-512.png', tamanho: 512, escala: 0.74 },
  // Maskable: o sistema recorta as bordas, então o desenho fica menor.
  { nome: 'icon-maskable-512.png', tamanho: 512, escala: 0.56 },
];

for (const a of arquivos) {
  const buf = png(a.tamanho, a.tamanho, desenhar(a.tamanho, a.escala));
  fs.writeFileSync(path.join(SAIDA, a.nome), buf);
  console.log('gerado', a.nome, '(' + buf.length + ' bytes)');
}
