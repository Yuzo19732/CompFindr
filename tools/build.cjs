/* ==========================================================================
   build.cjs — o que roda antes de publicar
   --------------------------------------------------------------------------
   Duas tarefas:
     1. gera os ícones (make-icons.cjs);
     2. carimba a versão no service worker.

   A segunda existe por um detalhe fácil de errar: o navegador só reinstala o
   service worker quando o ARQUIVO sw.js muda. Com a versão fixa no código,
   quem já tinha o app instalado continuaria vendo o CSS e o JS antigos para
   sempre, mesmo com o Netlify publicando arquivos novos.

   Carimbando o identificador do commit, todo deploy muda o sw.js, o navegador
   percebe, reinstala e troca o cache. No Netlify a variável COMMIT_REF já vem
   pronta; rodando na mão, usa a hora.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

require('./make-icons.cjs');

const SW = path.join(__dirname, '..', 'public', 'sw.js');

function versaoDoBuild() {
  const commit = process.env.COMMIT_REF || process.env.GITHUB_SHA;
  if (commit) return 'compfindr-' + commit.slice(0, 8);
  return 'compfindr-local-' + Date.now();
}

const versao = versaoDoBuild();
const original = fs.readFileSync(SW, 'utf8');
const novo = original.replace(
  /const VERSAO = '[^']*';/,
  "const VERSAO = '" + versao + "';"
);

if (novo === original) {
  console.error('AVISO: não achei a linha da versão em sw.js — o cache pode ficar preso.');
  process.exitCode = 1;
} else {
  fs.writeFileSync(SW, novo);
  console.log('versão do service worker:', versao);
}
