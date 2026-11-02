# Brazil Peptides — catálogo estático

Site estático em HTML, CSS e JavaScript. Não há carrinho, checkout, banco de dados ou pagamento online: o contato acontece pelo WhatsApp.

## Editar produtos e preços

Edite somente `data/catalog.json` para alterar a marca, o número de WhatsApp, os produtos, as descrições e os preços.

- `whatsapp`: número completo com código do país e DDD, somente dígitos. Exemplo de formato: `5511999999999` (troque pelo número correto).
- `active`: use `true` para mostrar o produto ou `false` para ocultá-lo.
- `variants`: cada item define uma apresentação e seu preço em reais. Exemplo: `{"size":"10 mg","price":100}`.
- `description`, `uses` e `evidence`: mantenha informações factuais, fontes verificáveis e linguagem que não prometa resultados clínicos.
- IDs devem ser únicos. O arquivo precisa continuar sendo JSON válido.

Os produtos no arquivo são exemplos demonstrativos; substitua-os antes de publicar. Não publique preços, nomes ou alegações que não tenham sido verificados.

## Publicar no GitHub Pages

1. No repositório, abra **Settings → Pages**.
2. Em **Build and deployment**, selecione **Deploy from a branch**.
3. Escolha a branch `main` e a pasta `/ (root)`, depois salve.
4. Aguarde a publicação e abra a URL informada pelo GitHub Pages.

O site carrega o catálogo por `fetch('./data/catalog.json')`; portanto, abra pela URL publicada ou por um servidor local, e não diretamente como arquivo `file://`.

## Estrutura

- `index.html` — layout, estilos e interação.
- `data/catalog.json` — dados editáveis dos produtos, descrições, tamanhos, preços e WhatsApp.

## Aviso

As informações do catálogo são apenas informativas e não substituem avaliação profissional ou consulta às autoridades regulatórias. Confirme a legalidade, a situação regulatória e os requisitos de comercialização aplicáveis antes de publicar ou oferecer qualquer item.
