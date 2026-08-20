/* ==========================================================================
   dev-server.mjs — servidor local para testar antes de publicar
   --------------------------------------------------------------------------
   Serve a pasta public/ e responde /.netlify/functions/* chamando as mesmas
   funções que o Netlify vai rodar em produção. Sem instalar nada.

       node tools/dev-server.mjs        ->  http://localhost:8787

   Observação: no PC a câmera funciona em localhost. No celular, acessando
   pelo IP da rede, o navegador BLOQUEIA a câmera por não ser HTTPS — para
   testar no celular, publique no Netlify.
   ========================================================================== */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLICO = path.join(RAIZ, 'public');
const PORTA = Number(process.env.PORT || 8787);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const funcoes = {
  liga: (await import('../netlify/functions/liga.mjs')).default,
  ptcg: (await import('../netlify/functions/ptcg.mjs')).default,
};

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  // --- funções ---
  // /api/liga é a rota da edge function em produção; aqui responde a mesma coisa.
  const m = url.pathname === '/api/liga'
    ? [null, 'liga']
    : url.pathname.match(/^\/\.netlify\/functions\/([\w-]+)$/);
  if (m) {
    const fn = funcoes[m[1]];
    if (!fn) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'função "' + m[1] + '" não existe' }));
      return;
    }
    try {
      const resposta = await fn(new Request(url.href, { method: req.method }));
      const corpo = await resposta.text();
      const cab = {};
      resposta.headers.forEach((v, k) => { cab[k] = v; });
      res.writeHead(resposta.status, cab);
      res.end(corpo);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: String(e && e.message ? e.message : e) }));
    }
    return;
  }

  // --- arquivos estáticos ---
  let caminho = decodeURIComponent(url.pathname);
  if (caminho === '/' || caminho.endsWith('/')) caminho += 'index.html';

  const alvo = path.join(PUBLICO, path.normalize(caminho).replace(/^([/\\])+/, ''));
  if (!alvo.startsWith(PUBLICO)) { res.writeHead(403); res.end('nope'); return; }

  fs.readFile(alvo, (erro, dados) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 — ' + caminho);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(dados);
  });
});

servidor.listen(PORTA, () => {
  console.log('CompFindr rodando em http://localhost:' + PORTA);
});
