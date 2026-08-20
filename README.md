# CompFindr

Site que escaneia cartas Pokémon pela câmera, identifica qual é e mostra o preço na
LigaPokémon (em reais), TCGPlayer (USD) e Cardmarket (EUR). Tem wishlist e coleção,
e pode ser instalado como aplicativo no celular direto pela página.

---

## Como rodar no PC

```bash
node tools/dev-server.mjs
```

Abre em `http://localhost:8787`. Não precisa instalar nada — o servidor usa só o que
já vem no Node.

A câmera funciona em `localhost`. **No celular, acessando pelo IP da rede, o navegador
bloqueia a câmera** porque não é HTTPS. Para testar no celular, publique (abaixo).

---

## Como publicar no Netlify

1. Suba esta pasta para um repositório no GitHub.
2. No Netlify: **Add new site → Import an existing project** e escolha o repositório.
3. As configurações já vêm prontas no `netlify.toml`; é só confirmar:
   - **Build command:** `node tools/make-icons.cjs`
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
4. Publique. O Netlify entrega em HTTPS, então a câmera funciona no celular.

Sem repositório, dá para arrastar a pasta em **Sites → Add new site → Deploy manually**,
mas aí as funções do servidor não sobem e o preço da LigaPokémon não funciona.

### Opcional: chave da pokemontcg.io

Crie uma chave grátis em <https://dev.pokemontcg.io> e ponha em
**Site settings → Environment variables** como `POKEMONTCG_API_KEY`. Serve só para
aumentar o limite de consultas; sem ela funciona igual.

---

## Como instalar no celular

Abra o endereço do Netlify no celular:

- **Android (Chrome):** aparece o botão "Instalar" no topo da página. Se não aparecer,
  use o menu ⋮ → "Adicionar à tela inicial".
- **iPhone (Safari):** botão de compartilhar → "Adicionar à Tela de Início".
  (No iOS não existe o botão "Instalar" — é sempre por aí.)

Depois disso o app abre em tela cheia, com ícone próprio, e a casca funciona offline.

---

## Como o scanner funciona

Não existe API gratuita e confiável de "buscar carta por imagem". O caminho que
funciona é ler o texto impresso.

### O problema da resolução

O número do rodapé tem cerca de **1,7% da altura da carta**. Se a carta ocupa 1000px
na imagem, o número tem 17 pixels de altura — e aí o OCR erra quase sempre. Medido:
com a carta a 2000px de altura ele acerta mesmo desfocado; a 700px, erra tudo.

É por isso que existem três formas de escanear, da mais confiável para a menos:

| Modo | Como usar | Confiabilidade |
| --- | --- | --- |
| **Só o número** (padrão) | Encher a tarja branca só com o `125/197` | Melhor — o número ocupa a imagem toda |
| **Usar uma foto** | Foto pelo app de câmera do celular | Boa — foto tem muito mais resolução que vídeo |
| **Carta inteira** | Encaixar a carta na moldura | Só com câmera boa |

A câmera é aberta pedindo a maior resolução que o aparelho aceitar (não 1080p), com
foco contínuo. Se o aparelho tiver zoom óptico, aparece um controle de zoom — ele
ajuda a ficar longe o bastante para o foco pegar e ainda encher a tarja.

### O funil de identificação

1. O Tesseract lê a faixa em até quatro passadas, com pontos de corte diferentes entre
   preto e branco (carta comum e full-art pedem cortes diferentes). Modo de página 6,
   não 7 — o rodapé tem duas linhas.
2. O `/` sai errado com frequência: `161/131` vira `1617131`. Então o app não confia
   numa leitura só — monta uma **lista de candidatos** (`161/131`, `16/1713`, …).
3. Descarta o impossível: se nenhuma coleção do jogo tem 378 cards, `677/378` não é
   carta.
4. Consulta todos os candidatos restantes **em paralelo** (cada um custa ~200ms).
5. **Confere pelo nome.** Este passo é o que evita o pior tipo de erro. Se o OCR perde
   um dígito e lê `25/197` em vez de `125/197`, as duas cartas existem — sem
   conferência o app entregaria Scovillain no lugar de Charizard ex. O nome do topo é
   lido e usado de duas formas: descarta o que não bate e, melhor, **procura a carta
   certa** (a busca da base é por substring, então o "harizard" sujo do OCR já acha
   Charizard).
6. Entre cartas de nome igual — artes alternativas, como os quatro Charizard ex da
   mesma coleção — o número lido desempata: se o OCR leu "25", o 125 é mais provável
   que o 228, porque "25" termina o 125.

Se ainda assim falhar, **"Ver o que a câmera leu"** mostra o recorte exato que o OCR
recebeu, o texto cru e os candidatos testados. É por aí que se descobre o motivo:
recorte pequeno, borrado ou fora do número.

Testado com foto de carta comum, holo e full-art: as quatro cartas de teste
identificam certo. Foto de celular na mão, com reflexo e ângulo, é mais difícil — o
diagnóstico existe justamente para isso.

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
erro 502 em cerca de **3 de cada 5 chamadas**. Como havia retentativa com espera
crescente, cada consulta gastava segundos antes de desistir — era essa a causa da
lentidão. A `tcgdex.net` respondeu 100% das vezes em ~0,7s, aceita chamada direta
(tem CORS liberado, então nem passa pelo servidor) e traz os preços de TCGPlayer e
Cardmarket. Resultado: identificar uma carta caiu de vários segundos para **~200ms**.

A lista de coleções é baixada uma vez e guardada por uma semana. Com ela na mão,
identificar "125/197" não custa busca nenhuma: o total (197) diz quais coleções têm
esse tamanho, e aí basta pedir a carta 125 de cada uma.

**Sobre a LigaPokémon:** eles não têm API pública, então a função lê o HTML da página
de busca. Isso quebra se eles mudarem o layout do site — toda a parte frágil está
isolada em `parseCardPage()` e `parseLista()` no arquivo `netlify/functions/liga.mjs`.
O app faz no máximo duas consultas por vez e guarda o resultado por 15 minutos, para
não pesar no site deles.

---

## Estrutura

```
public/               o site em si (é isto que o Netlify publica)
  index.html
  css/style.css
  js/store.js         wishlist, coleção e ajustes (localStorage)
  js/api.js           conversa com as funções do servidor
  js/ocr.js           leitura do texto da carta + lista de candidatos
  js/scanner.js       câmera, moldura e recorte
  js/app.js           cola tudo e desenha a tela
  sw.js               cache da casca do app (desligado em localhost)

netlify/functions/
  liga.mjs            preço na LigaPokémon
  ptcg.mjs            identificação da carta (+ reserva + totais de coleção)

tools/
  dev-server.mjs      servidor local, sem dependências
  make-icons.cjs      gera os ícones no build
```

Os dados ficam só no navegador do aparelho. Use **Ajustes → Exportar** para não perder.

---

## Quando não conseguir ler a carta

Abra **"Ver o que a câmera leu"** logo abaixo do botão. O recorte mostrado é
exatamente o que o OCR recebeu.

- **O número aparece pequeno no recorte** — chegue mais perto, use o zoom, ou troque
  para "Só o número".
- **O recorte está borrado** — a maioria dos celulares não consegue focar a menos de
  ~10cm. Afaste um pouco e use o zoom, ou tire uma foto pelo app de câmera e use
  "Usar uma foto".
- **O recorte não mostra o número** — a moldura está no lugar errado; ajuste o
  enquadramento.
- **Reflexo na carta (holo/full-art)** — incline a carta até o brilho sair de cima do
  número, ou ligue a lanterna.

Em qualquer caso, **digitar o número na mão** funciona e é rápido: o campo fica na
mesma tela, em "Digitar o número na mão".

---

## Ainda por fazer

- PriceCharting e Collectr como fontes adicionais de preço.
- Quantidade e condição da carta na coleção (hoje é só "tenho / não tenho").
- Alerta de pechincha: avisar quando uma carta da wishlist cair abaixo de um valor.
- Histórico de preço com gráfico.
