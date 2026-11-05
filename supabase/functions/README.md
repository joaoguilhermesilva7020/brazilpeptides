# Edge Functions — pedidos e pagamentos

Esta etapa adiciona duas funções sem alterar o frontend:

- `create-order`: cria um pedido pendente usando IDs de variantes e preços lidos no PostgreSQL.
- `confirm-payment`: exige sessão autenticada e valida novamente o papel de administrador no banco.

## Implantação

Depois de mesclar a migration e revisar o PR:

```bash
supabase link --project-ref xuutmhgjrrsmtropldwh
supabase db push
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy confirm-payment
```

As funções usam automaticamente `SUPABASE_URL` e `SUPABASE_ANON_KEY` do ambiente Supabase. Não configure nem exponha a chave `service_role` no navegador.

## Contratos HTTP

### POST /functions/v1/create-order

Não exige JWT de usuário; o gateway ainda exige a chave pública anon no cabeçalho `apikey`.

Exemplo de corpo:

```json
{
  "customer_name": "Cliente",
  "customer_phone": "5583999999999",
  "customer_email": null,
  "payment_method": "pix",
  "affiliate_ref": null,
  "notes": null,
  "items": [
    { "variant_id": "UUID-DA-VARIANTE", "quantity": 1 }
  ]
}
```

O cliente envia apenas os identificadores das variantes e quantidades. Preços, nomes, subtotal e total são calculados no servidor. Valores de preço enviados pelo navegador são ignorados.

### POST /functions/v1/confirm-payment

Exige JWT de usuário administrador no cabeçalho `Authorization: Bearer <access_token>`.

```json
{
  "order_id": "UUID-DO-PEDIDO",
  "payment_reference": "referência opcional",
  "notes": "observação opcional"
}
```

A autorização é validada pela função SQL `public.is_admin()`; não é aceito um identificador de administrador informado pelo cliente.

## Regras transacionais

- Criar pedido não reserva nem baixa estoque.
- Confirmar pagamento bloqueia o pedido e os saldos de estoque, verifica todas as quantidades e realiza a baixa na mesma transação.
- Se uma variante não tiver saldo cadastrado ou não houver quantidade suficiente, toda a confirmação é revertida.
- Uma segunda chamada para um pedido já confirmado retorna `already_confirmed: true` sem repetir a baixa.
- A comissão só é registrada após a confirmação e apenas se o afiliado estiver ativo e tiver uma taxa maior que zero.
- Os afiliados de exemplo estão inativos e as taxas permanecem em zero até decisão comercial.

## Testes antes de conectar o site

1. Criar um pedido com uma variante ativa e conferir o preço calculado no banco.
2. Enviar um preço adulterado no corpo (a função não o utiliza).
3. Tentar criar pedido com variante inativa/inexistente, quantidade fracionária e afiliado inativo.
4. Confirmar pagamento com usuário não administrador (deve falhar).
5. Confirmar como administrador sem saldo cadastrado (deve falhar sem alterar pedido, pagamento ou estoque).
6. Cadastrar saldo real para as variantes de teste e confirmar pagamento.
7. Repetir a confirmação (não pode baixar estoque novamente).
8. Conferir `inventory_movements`, `order_status_history` e eventual comissão.

**Importante:** o catálogo importado não criou saldos fictícios. Antes de vender e confirmar pedidos, cadastre as quantidades reais em `inventory_balances`. A interface ainda não foi conectada a estas funções.
