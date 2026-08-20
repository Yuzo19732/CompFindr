# CompFindr

Site para achar uma carta Pokémon pelo número do rodapé e ver quanto ela vale — na
LigaPokémon (reais), TCGPlayer (dólar) e Cardmarket (euro). Tem wishlist, coleção com
valor total e estimativa de preço por estado de conservação. Instala como aplicativo
no celular direto pela página.

---

## Como rodar no PC

```bash
node tools/dev-server.mjs
```

Abre em `http://localhost:8787`. Não precisa instalar nada — o servidor usa só o que
já vem no Node.

---

## Como publicar no Netlify

1. Suba esta pasta para um repositório no GitHub.
2. No Netlify: **Add new site → Import an existing project** e escolha o repositório.
3. As configurações já vêm prontas no `netlify.toml`; é só confirmar:
   - **Build command:** `node tools/build.cjs`
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
4. Publique.

Feito isso uma vez, **todo `git push` para o `main` republica sozinho**. Não precisa
mexer no Netlify de novo.

### Opcional: chave da pokemontcg.io

Crie uma chave grátis em <https://dev.pokemontcg.io> e ponha em
**Site settings → Environment variables** como `POKEMONTCG_API_KEY`. Serve só para a
fonte reserva; sem ela funciona igual.

---

## Como instalar no celular

Abra o endereço do Netlify no celular:

- **Android (Chrome):** aparece o botão "Instalar" no topo da página. Se não aparecer,
  use o menu ⋮ → "Adicionar à tela inicial".
- **iPhone (Safari):** botão de compartilhar → "Adicionar à Tela de Início".
  (No iOS não existe o botão "Instalar" — é sempre por aí.)

Depois disso o app abre em tela cheia, com ícone próprio, e a casca funciona offline.

---

## Como buscar

Um campo só. O que for digitado decide a busca:

| O que você digita | O que acontece |
| --- | --- |
| `125/197` (também `125 197`, `125-197`) | Busca pelo número do rodapé — é o jeito exato |
| `Charizard` | Busca por nome, mostra as cartas mais recentes primeiro |

**Por que o número é o melhor caminho:** o segundo número é o tamanho da coleção, e
quase nenhuma coleção tem o mesmo tamanho de outra. Então "197" já diz que é Obsidian
Flames, e "125" diz qual carta dentro dela. Some tudo: uma carta exata, em ~200ms,
sem ambiguidade.

Quando duas coleções têm o mesmo tamanho, o app mostra as duas cartas lado a lado com
a arte, e você escolhe a certa de olho.

> Versões anteriores tinham leitura por câmera (OCR). Foi removida: dependia de
> resolução e foco que a maioria dos celulares não entrega num alvo do tamanho do
> número do rodapé, e digitar seis dígitos é mais rápido e sempre funciona. O código
> está no histórico do Git, se um dia fizer sentido voltar.

---

## De onde vem cada dado

| Dado | Fonte | Como |
| --- | --- | --- |
| Qual carta é, imagem, coleção | **`tcgdex.net`** | API pública, chamada direto do navegador |
| Preço USD / EUR | TCGPlayer / Cardmarket | vem junto da `tcgdex.net`, atualizado todo dia |
| Preço em reais | **LigaPokémon** | leitura da página deles, pelo servidor |
| Reserva se a tcgdex cair | `pokemontcg.io` | função `/ptcg` no servidor |
| Cotação do dia | `economia.awesomeapi.com.br` | atualiza sozinho 1× por dia |

**Por que a tcgdex é a principal.** Medido em 2026-08-20: a `pokemontcg.io` responde
erro 502 em cerca de **3 de cada 5 chamadas**. A `tcgdex.net` respondeu 100% das vezes
em ~0,7s, aceita chamada direta (tem CORS liberado, então nem passa pelo servidor) e
traz os preços de TCGPlayer e Cardmarket.

A lista de coleções é baixada uma vez e guardada por uma semana. Com ela na mão,
achar "125/197" não custa busca nenhuma: o total (197) diz quais coleções têm esse
tamanho, e aí basta pedir a carta 125 de cada uma.

### O preço em reais só funciona rodando local

Medido em 2026-08-20: **publicado no Netlify, a LigaPokémon recusa o pedido.** Ela
fica atrás do Cloudflare, que responde `403` com `cf-mitigated: challenge` — a página
"Just a moment…". Isso vale para as duas rotas:

| De onde sai o pedido | Ponto de presença | Resultado |
| --- | --- | --- |
| Função comum do Netlify | Ohio, EUA | 403 challenge |
| Edge function (`/api/liga`) | São Paulo | 403 challenge |
| `node tools/dev-server.mjs` no PC | São Paulo | 200 OK |

Não é geografia — a edge function chegou a rodar por São Paulo e mesmo assim foi
barrada. É detecção de automação sobre infraestrutura de nuvem. Passar por cima disso
significaria derrotar uma proteção anti-bot, coisa que este projeto não faz.

O app percebe sozinho (desiste depois de duas tentativas na sessão), explica na tela e
oferece o link para abrir a carta na Liga. Para diagnosticar de qualquer lugar:
`https://<seu-site>/api/liga?nome=Pikachu&debug=1`.

### Preço anotado à mão

Como o número do mercado brasileiro é justamente o que interessa, cada carta tem um
campo **"Preço que você viu na Liga"**. Abre o link, olha o valor, anota uma vez.

Esse número passa a valer mais que qualquer outro: aparece na grade, soma no total da
coleção, vira a base da tabela de estados e entra no backup.

---

## Estado de conservação (M, NM, SP, MP, HP, D)

Cada carta mostra uma tabela de valor estimado por estado, com as siglas da
LigaPokémon:

| Sigla | Significado | Padrão |
| --- | --- | --- |
| M | Nova | 115% |
| NM | Praticamente Nova | 100% (referência) |
| SP | Usada Levemente | 85% |
| MP | Usada Moderadamente | 70% |
| HP | Muito Usada | 50% |
| D | Danificada | 30% |

**Estes valores são estimativa, não dado da LigaPokémon.** A Liga tem o preço de cada
anúncio por estado, mas publica esses números como **imagem** (um sprite de CSS onde
cada dígito é um pedaço de um JPEG), de propósito, para não serem lidos por programa.
O filtro de qualidade também não muda os valores agregados que eles publicam em texto.

O app aplica proporções de mercado sobre um preço de referência — o que você anotou,
senão o médio da Liga, senão o do TCGPlayer. Editáveis em **Ajustes → Estado de
conservação**.

---

## Cartas do jogo de celular

As coleções do **Pokémon TCG Pocket** ficam de fora por padrão. Elas não são cartas
físicas e atrapalhavam de dois jeitos: ocupavam lugar na busca por nome (numa busca
por "pikachu", 16 dos 60 resultados eram do jogo) e colidiam por número — "Paldean
Wonders" tem 131 cards, o mesmo total de Prismatic Evolutions.

Dá para religar em **Ajustes → Busca**.

---

## Estrutura

```
public/               o site em si (é isto que o Netlify publica)
  index.html
  css/style.css
  js/store.js         wishlist, coleção, preços anotados e ajustes (localStorage)
  js/api.js           busca de cartas e preços
  js/app.js           cola tudo e desenha a tela
  sw.js               cache da casca do app (desligado em localhost)

netlify/
  functions/liga.mjs  preço na LigaPokémon
  functions/ptcg.mjs  fonte reserva de cartas
  edge-functions/     a mesma consulta da Liga, rodando na borda

tools/
  dev-server.mjs      servidor local, sem dependências
  build.cjs           roda no deploy: ícones + versão do service worker
  make-icons.cjs      gera os ícones
```

Os dados ficam só no navegador do aparelho. Use **Ajustes → Exportar** para não perder.

**Sobre a versão do service worker.** O navegador só reinstala o service worker quando
o arquivo `sw.js` muda. Com uma versão fixa no código, quem já instalou o app
continuaria vendo o CSS e o JS antigos para sempre, mesmo com o deploy novo no ar. Por
isso o `build.cjs` carimba o identificador do commit no `sw.js` a cada publicação — a
linha `const VERSAO` no repositório é só um valor de espera.

---

## Ainda por fazer

- Quantidade e estado real da carta na coleção (hoje o estado é estimativa geral).
- Alerta de pechincha: avisar quando uma carta da wishlist cair abaixo de um valor.
- Histórico de preço com gráfico.
- PriceCharting e Collectr como fontes adicionais.
