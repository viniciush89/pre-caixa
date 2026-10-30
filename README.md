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
- **Nome automático**: busca o código no catálogo aberto [Open Food Facts](https://world.openfoodfacts.org) e nos catálogos irmãos.
- **Preço**:
  - você digita uma vez e o celular lembra na próxima compra;
  - etiqueta de balança (EAN-13 começando com `2`) já traz o total no código.
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
