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
funciona é ler o texto impresso:

1. A câmera congela um quadro e recorta **a faixa de baixo da carta**, onde fica o
   número do coletor (`125/197`).
2. O Tesseract lê essa faixa quatro vezes, com pontos de corte diferentes entre preto
   e branco. Cartas full-art precisam de ajuste diferente das comuns.
3. O `/` sai errado com frequência — `161/131` vira `1617131`. Por isso o app não
   confia numa leitura só: ele monta uma **lista de candidatos** e pergunta à base de
   cartas qual deles existe de verdade. Quem decide é o banco de dados, não o OCR.
4. Antes de consultar, joga fora o impossível: se nenhuma coleção do jogo tem 378
   cards, `677/378` não é carta.
5. Se o número der empate (duas coleções com o mesmo total), aí sim ele lê o **nome**
   no topo e escolhe por semelhança de texto.

Testado com carta comum, holo e full-art. A full-art é a mais difícil e é a que exige
a lista de candidatos.

---

## De onde vem cada dado

| Dado | Fonte | Como |
| --- | --- | --- |
| Qual carta é, imagem, coleção | `pokemontcg.io` | API pública, sem chave |
| Reserva quando a de cima cai | `tcgdex.net` | API pública (sem preço) |
| Preço em reais | **LigaPokémon** | leitura da página de busca deles |
| Preço USD / EUR | TCGPlayer / Cardmarket | vem junto da `pokemontcg.io` |
| Cotação do dia | `economia.awesomeapi.com.br` | atualiza sozinho 1× por dia |

A `pokemontcg.io` cai com alguma frequência (erro 500/502). Por isso a função do
servidor tenta quatro vezes antes de desistir e, se ainda assim falhar, usa a
`tcgdex.net` para pelo menos identificar a carta.

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

## Ainda por fazer

- PriceCharting e Collectr como fontes adicionais de preço.
- Quantidade e condição da carta na coleção (hoje é só "tenho / não tenho").
- Alerta de pechincha: avisar quando uma carta da wishlist cair abaixo de um valor.
- Histórico de preço com gráfico.
