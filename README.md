# Pré-Caixa

App web instalável (PWA) para saber quanto a conta do mercado vai dar antes de passar no caixa.
Você aponta a câmera para o código de barras, confere preço e quantidade, e o total vai somando no topo.

## O que faz

- **Leitor ao vivo**: câmera traseira com moldura, bip e vibração.
  - Motor ZXing-C++ em WebAssembly, o mesmo no Android e no iPhone. No Android, o leitor nativo do Chrome entra em quadros alternados.
  - Cada quadro é lido de um jeito: imagem crua, realce contra desfoque (leve, médio e forte), largura dobrada para código pequeno e a tela inteira para código girado.
  - Leituras com realce só valem quando dois métodos concordam, para não aceitar código errado.
  - Abre a lente principal (no Android, troca para a `camera2 0` se o navegador abrir outra), com foco contínuo e zoom de 1,5× (2× no iPhone).
  - Na tela do leitor dá para trocar a lente, ligar a lanterna, mudar o zoom e tocar na imagem para focar.
  - Formatos lidos: EAN-13, EAN-8, UPC-A, UPC-E e ITF-14.
- **Modo rápido**: produto com preço salvo entra no carrinho com o bip, sem abrir a tela do item; uma faixa amarela
  mostra nome e preço, com Desfazer e Editar. Se o produto já está no carrinho, ele pergunta antes ("Mais 1"), porque a
  câmera pode passar de novo pelo produto dentro do carrinho. Dá para desligar nas Opções.
- **Começo e fim de compra**: na primeira leitura de uma compra nova, o app pergunta o mercado e quanto pretende gastar
  (com atalhos). No fim do cupom fica o botão **Finalizar compra**, que guarda no histórico, tira da lista o que já foi
  pego e zera carrinho e mercado.
- **Topo compacto**: quando o total grande sai da tela, uma faixa fina com o total e quanto falta fica no topo.
- **Nome automático**: busca o código no catálogo aberto [Open Food Facts](https://world.openfoodfacts.org) e nos catálogos irmãos.
- **Preço**:
  - você digita uma vez e o celular lembra na próxima compra, inclusive item sem código (pão, frutas, frios), guardado pelo nome;
  - etiqueta de balança (EAN-13 começando com `2`) já traz o total no código.
- **Lista de compras**: você monta em casa (aceita "2 leite", "leite x2", "café (2)"); sugere os produtos que você mais
  compra. No mercado, o app mostra a previsão de quanto a compra vai fechar com o que falta. Na compra nova, os itens
  já pegos saem da lista.
- **Risca a lista sozinho**: cada produto que entra no carrinho (escaneado, digitado ou editado) risca o item da lista
  que ele é. Sem IA:
  - compara sem plural e feminino (pães = pão, moída = moído) e sem as palavras pequenas ("farinha de trigo" =
    "Farinha Trigo");
  - entende sinônimos (sabão em pó = lava roupas, detergente = lava louças, bolacha = biscoito, pasta de dente =
    creme dental) e tipos (refrigerante → Coca, Guaraná; queijo → mussarela; carne → patinho; frutas → banana);
  - não confunde produto feito do ingrediente: "leite" não é riscado por creme de leite ou leite condensado, "tomate"
    por molho de tomate, "laranja" por suco de laranja;
  - na tela do item aparece "Vai riscar da lista: …" antes de adicionar, com os outros itens para trocar ou desmarcar;
  - **aprende com você**: se não reconheceu, marque o item na lista e toque em "Foi um destes?" no produto certo, ou
    escolha o item na tela do item. Se riscou errado, desmarque e toque em "Não era esse". Da próxima vez ele acerta.
  - item posto na lista com o produto já no carrinho é riscado na hora.
- **Lista pelo WhatsApp**:
  - **WhatsApp** manda o que falta comprar ("• 3 leite"); **Compartilhar** (ou **Copiar**) usa outro app.
  - **Colar lista** traz o texto copiado de uma conversa. Aceita um item por linha ou separado por vírgula, e limpa
    marcadores, numeração, caixinhas `[ ]`, emojis e o negrito do WhatsApp. Item que já está na lista fica com a maior
    quantidade, sem somar de novo; item já pego não volta.
  - No Android, com o app instalado, o Pré-Caixa aparece no menu **Compartilhar**: segure a mensagem da lista no
    WhatsApp, toque em Compartilhar e escolha o Pré-Caixa (`share_target` no manifesto).
- **Conferir no caixa**: no fim do cupom, o botão vira o cupom numa lista de conferência. Toque em cada item quando o
  caixa passar; se a tela do caixa mostrar outro preço, **Cobrou outro valor?** guarda o valor cobrado. Um cartão
  preso no topo mostra quantos faltam, quanto falta conferir e quanto foi cobrado a mais ou a menos.
- **Compras anteriores**: cada compra finalizada guarda os itens. Em Opções, toque numa compra para ver o cupom,
  **Comprar de novo** (põe tudo na lista) ou apagar do histórico. Com o carrinho vazio, aparece a última compra.
- **Nome que faltou**: produto escaneado sem internet fica com o código; quando a internet volta, o app procura o
  nome sozinho e risca o item da lista, se bater.
- **Esse preço subiu?**: cada produto guarda o histórico de preços com data e mercado. Ao escanear, o app mostra a
  última compra, se subiu ou baixou (em R$ e %) e o menor preço visto nos últimos 90 dias, inclusive em outro mercado.
  No cupom, as linhas mostram ▲/▼ e o rodapé soma quanto ficou mais caro ou mais barato.
- **Mercado em um toque**: Guanabara, Mundial e Supermarket aparecem como atalhos, junto dos mercados já usados.
- **Orçamento com alerta de cor**: o total fica amarelo, laranja aos 75%, vermelho aos 90% e listrado quando passa. A cada mudança de faixa o celular vibra, toca um aviso e mostra quanto falta.
- **Dados no celular**: carrinho, preços e histórico ficam no `localStorage` do aparelho. Backup em arquivo nas Opções.
- **Sem sinal**: o service worker guarda o app, inclusive o leitor; depois da primeira abertura ele funciona offline.

## Publicar

É um site estático, sem build. Qualquer hospedagem com **https** serve (GitHub Pages, sua VPS, Netlify).
Câmera, instalação e modo offline só funcionam em https (ou `localhost` para testes).

Ao publicar uma versão nova, troque `VERSION` em `sw.js` e o `?v=` de `app.js` e `app.css` no `index.html`.
O app recarrega sozinho na versão nova.

Teste local:

```bash
python3 -m http.server 8080   # abra http://localhost:8080
```

## Tabela de preços do mercado (opcional)

Em **Opções → Avançado**. Só faz sentido se o mercado oferecer uma consulta de preços.
O endpoint precisa responder com `Access-Control-Allow-Origin`. Para cada código lido, o app chama:

```
GET {URL}?ean=7891000100103&mercado=Guanabara%20Méier
```

Se a URL tiver `{ean}` e `{mercado}`, eles são substituídos no lugar. Resposta esperada:

```json
{ "nome": "Achocolatado Nescau 400g", "preco": 9.49 }
```

Também aceita `name`, `price` e `preco_por_kg` (true/false). O preço da consulta vale mais que o preço salvo no
celular, mas nunca passa por cima do que a pessoa digitou.

## Diagnóstico

Em **Opções → Seus dados** aparece qual motor de leitura e qual câmera o celular está usando. Isso ajuda a
entender um aparelho que lê mal.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html`, `app.css`, `app.js` | o app |
| `sw.js` | cache para funcionar sem sinal |
| `manifest.webmanifest`, `icons/` | instalação na tela inicial |
| `vendor/zxing-wasm-reader-3.1.5.js`, `vendor/zxing_reader-3.1.5.wasm` | leitor ZXing-C++ (zxing-wasm, MIT; licença em `vendor/ZXING-WASM-LICENSE.txt`) |
| `vendor/zxing-library-0.21.3.min.js` | leitor reserva, só carregado se o WebAssembly falhar (Apache 2.0) |
| `fonts/` | Sofia Sans e Fragment Mono (SIL Open Font License) |

Pela Lei 10.962/2004, art. 5º, se o preço do caixa for diferente da etiqueta, vale o menor.
