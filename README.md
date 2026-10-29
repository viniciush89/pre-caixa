# Pré-Caixa

App web instalável (PWA) para saber quanto a conta do mercado vai dar antes de passar no caixa.
Você aponta a câmera para o código de barras, confere preço e quantidade, e o total vai somando no topo.

## O que faz

- **Leitor ao vivo**: câmera traseira com moldura e bip. Usa o leitor nativo do Android (BarcodeDetector) e, no iPhone, a biblioteca ZXing incluída no app. Lê EAN-13, EAN-8, UPC, ITF-14 e Code 128.
- **Nome automático**: busca o código no catálogo aberto [Open Food Facts](https://world.openfoodfacts.org) (e nos catálogos irmãos de higiene e outros produtos).
- **Preço**:
  - produto já comprado volta com o último preço salvo neste celular;
  - etiqueta de balança (EAN-13 começando com `2`) já traz o total no código;
  - consulta opcional ao sistema do mercado e leitura de etiqueta por foto (veja Integrações).
- **Controle**: orçamento com barra que muda de cor, quantidade ou peso (kg), desfazer, histórico de compras.
- **Dados no celular**: carrinho, preços e histórico ficam no `localStorage` do aparelho. Backup em arquivo nas Opções.
- **Sem sinal**: o service worker guarda o app; depois da primeira abertura ele abre offline.

## Publicar

É um site estático, sem build. Qualquer hospedagem com **https** serve (GitHub Pages, sua VPS, Netlify).
Câmera, instalação e modo offline só funcionam em https (ou `localhost` para testes).

Ao publicar uma versão nova, troque `VERSION` em `sw.js` para os celulares baixarem os arquivos de novo.

Teste local:

```bash
python3 -m http.server 8080   # abra http://localhost:8080
```

## Integrações (opcionais)

Configuradas em **Opções → Integrações**, direto no celular. Os endpoints precisam responder com
`Access-Control-Allow-Origin` (no n8n: opção *Allowed Origins (CORS)* do nó Webhook).

### Consulta de preço

Para cada código lido, o app chama:

```
GET {URL}?ean=7891000100103&mercado=Guanabara%20Méier
```

Se a URL tiver `{ean}` e `{mercado}`, eles são substituídos no lugar. Resposta esperada:

```json
{ "nome": "Achocolatado Nescau 400g", "preco": 9.49 }
```

Também aceita `name`, `price`, `preco_por_kg` (true/false) e `observacao`. O preço da consulta vale mais que o
preço salvo no celular, mas nunca passa por cima do que a pessoa digitou.

### Leitura de etiqueta por foto

Quando o produto não tem preço, o app envia a foto da etiqueta:

```
POST {URL}   (multipart/form-data)
foto     arquivo JPEG (~1280 px)
ean      código lido, se houver
mercado  nome do mercado, se informado
```

Resposta esperada:

```json
{ "nome": "Café Pilão Tradicional 500g", "preco": 18.9, "preco_por_kg": false, "codigo": "7896089012347", "observacao": "Clube: R$ 17,49" }
```

Um fluxo n8n simples: Webhook (POST, binário) → modelo com visão (Claude, por exemplo) com um prompt que pede só
esse JSON → Respond to Webhook.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html`, `app.css`, `app.js` | o app |
| `sw.js` | cache para funcionar sem sinal |
| `manifest.webmanifest`, `icons/` | instalação na tela inicial |
| `vendor/zxing-library-0.21.3.min.js` | leitor de código (Apache 2.0, licença em `vendor/ZXING-LICENSE.txt`) |
| `fonts/` | Sofia Sans e Fragment Mono (SIL Open Font License) |

Pela Lei 10.962/2004, art. 5º, se o preço do caixa for diferente da etiqueta, vale o menor.
