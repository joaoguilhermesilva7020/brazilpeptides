-- Transactional regression test for public.confirm_order_payment.
-- Run manually in the Supabase SQL Editor as the database owner.
-- All fixture rows and inventory changes are rolled back at the end.
-- Uses a negative, explicit order_number so the identity sequence is not advanced.
--
-- Covers:
-- 1) Missing inventory_balances row -> rejected, order/payment unchanged.
-- 2) Zero stock for quantity 1 -> rejected, order/payment unchanged.
-- 3) One unit in stock for quantity 1 -> payment confirmed, stock decremented,
--    and exactly one sale movement recorded.
--
-- This exercises the database RPC, not the HTTP/JWT behavior of the Edge Function.

begin;

do $test$
declare
  v_admin_id uuid;
  v_variant_id uuid := '147f7b33-7ed1-4500-8890-89953227fc14';
  v_product_name text;
  v_variant_name text;
  v_sku text;
  v_price numeric(12,2);
  v_order_id uuid;
  v_error text;
  v_result jsonb;
  v_order_status text;
  v_payment_status text;
  v_stock integer;
  v_movement_count integer;
begin
  select au.user_id
    into v_admin_id
  from public.admin_users au
  where au.active = true
  order by au.created_at
  limit 1;

  if v_admin_id is null then
    raise exception 'TEST SETUP FAILED: nenhum administrador ativo encontrado.';
  end if;

  select p.name, pv.name, pv.sku, pv.price
    into v_product_name, v_variant_name, v_sku, v_price
  from public.product_variants pv
  join public.products p on p.id = pv.product_id
  where pv.id = v_variant_id
    and pv.active = true
    and p.active = true;

  if not found then
    raise exception 'TEST SETUP FAILED: variante de teste inexistente ou inativa (%).', v_variant_id;
  end if;

  if v_price <= 0 then
    raise exception 'TEST SETUP FAILED: a variante precisa ter preço maior que zero.';
  end if;

  -- Simulate the authenticated administrator context used by auth.uid().
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);

  -- CASE 1: no inventory row must reject payment confirmation.
  delete from public.inventory_balances
  where variant_id = v_variant_id;

  insert into public.orders (
    order_number, customer_name, customer_phone, status, payment_status,
    subtotal, discount, total, notes
  ) overriding system value values (
    -100001, 'TESTE AUTOMATIZADO - SEM SALDO', '11999990001',
    'pending_payment', 'pending', v_price, 0, v_price, 'Fixture transacional; rollback esperado.'
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, variant_id, product_name_snapshot, variant_name_snapshot,
    sku_snapshot, unit_price, quantity, line_total
  ) values (
    v_order_id, v_variant_id, v_product_name, v_variant_name,
    v_sku, v_price, 1, v_price
  );

  insert into public.payments (order_id, method, amount, status)
  values (v_order_id, 'pix', v_price, 'pending');

  v_error := null;
  begin
    perform public.confirm_order_payment(v_order_id, 'TEST-NO-BALANCE', 'Teste automatizado');
  exception when others then
    v_error := sqlerrm;
  end;

  if v_error is null or v_error not like '%Estoque não cadastrado%' then
    raise exception 'CASE 1 FAILED: esperado erro de estoque não cadastrado; recebido: %', coalesce(v_error, 'nenhum erro');
  end if;

  select o.status, o.payment_status
    into v_order_status, v_payment_status
  from public.orders o
  where o.id = v_order_id;

  if v_order_status <> 'pending_payment' or v_payment_status <> 'pending' then
    raise exception 'CASE 1 FAILED: pedido/pagamento foram alterados após rejeição.';
  end if;

  -- CASE 2: a balance row exists but quantity_on_hand is insufficient.
  insert into public.inventory_balances (variant_id, quantity_on_hand, low_stock_threshold)
  values (v_variant_id, 0, 0)
  on conflict (variant_id) do update
    set quantity_on_hand = excluded.quantity_on_hand,
        low_stock_threshold = excluded.low_stock_threshold;

  insert into public.orders (
    order_number, customer_name, customer_phone, status, payment_status,
    subtotal, discount, total, notes
  ) overriding system value values (
    -100002, 'TESTE AUTOMATIZADO - ESTOQUE ZERO', '11999990002',
    'pending_payment', 'pending', v_price, 0, v_price, 'Fixture transacional; rollback esperado.'
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, variant_id, product_name_snapshot, variant_name_snapshot,
    sku_snapshot, unit_price, quantity, line_total
  ) values (
    v_order_id, v_variant_id, v_product_name, v_variant_name,
    v_sku, v_price, 1, v_price
  );

  insert into public.payments (order_id, method, amount, status)
  values (v_order_id, 'pix', v_price, 'pending');

  v_error := null;
  begin
    perform public.confirm_order_payment(v_order_id, 'TEST-INSUFFICIENT', 'Teste automatizado');
  exception when others then
    v_error := sqlerrm;
  end;

  if v_error is null or v_error not like '%Estoque insuficiente%' then
    raise exception 'CASE 2 FAILED: esperado erro de estoque insuficiente; recebido: %', coalesce(v_error, 'nenhum erro');
  end if;

  select o.status, o.payment_status
    into v_order_status, v_payment_status
  from public.orders o
  where o.id = v_order_id;

  if v_order_status <> 'pending_payment' or v_payment_status <> 'pending' then
    raise exception 'CASE 2 FAILED: pedido/pagamento foram alterados após rejeição.';
  end if;

  select ib.quantity_on_hand
    into v_stock
  from public.inventory_balances ib
  where ib.variant_id = v_variant_id;

  if v_stock <> 0 then
    raise exception 'CASE 2 FAILED: estoque deveria continuar em zero, encontrado: %', v_stock;
  end if;

  -- CASE 3: one unit available for an order of one unit must succeed.
  update public.inventory_balances
  set quantity_on_hand = 1,
      low_stock_threshold = 0
  where variant_id = v_variant_id;

  insert into public.orders (
    order_number, customer_name, customer_phone, status, payment_status,
    subtotal, discount, total, notes
  ) overriding system value values (
    -100003, 'TESTE AUTOMATIZADO - ESTOQUE SUFICIENTE', '11999990003',
    'pending_payment', 'pending', v_price, 0, v_price, 'Fixture transacional; rollback esperado.'
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, variant_id, product_name_snapshot, variant_name_snapshot,
    sku_snapshot, unit_price, quantity, line_total
  ) values (
    v_order_id, v_variant_id, v_product_name, v_variant_name,
    v_sku, v_price, 1, v_price
  );

  insert into public.payments (order_id, method, amount, status)
  values (v_order_id, 'pix', v_price, 'pending');

  v_result := public.confirm_order_payment(v_order_id, 'TEST-SUFFICIENT', 'Teste automatizado');

  if v_result->>'status' <> 'paid'
     or v_result->>'payment_status' <> 'confirmed'
     or v_result->>'already_confirmed' <> 'false' then
    raise exception 'CASE 3 FAILED: retorno inesperado da confirmação: %', v_result;
  end if;

  select o.status, o.payment_status
    into v_order_status, v_payment_status
  from public.orders o
  where o.id = v_order_id;

  if v_order_status <> 'paid' or v_payment_status <> 'confirmed' then
    raise exception 'CASE 3 FAILED: pedido e pagamento não foram confirmados.';
  end if;

  select ib.quantity_on_hand
    into v_stock
  from public.inventory_balances ib
  where ib.variant_id = v_variant_id;

  if v_stock <> 0 then
    raise exception 'CASE 3 FAILED: estoque esperado 0 após baixa de 1 unidade; encontrado: %', v_stock;
  end if;

  select count(*)
    into v_movement_count
  from public.inventory_movements im
  where im.reference_type = 'order'
    and im.reference_id = v_order_id
    and im.variant_id = v_variant_id
    and im.movement_type = 'sale'
    and im.quantity = 1;

  if v_movement_count <> 1 then
    raise exception 'CASE 3 FAILED: esperado exatamente 1 movimento de venda; encontrado: %', v_movement_count;
  end if;

  raise notice 'PASS: CASE 1 rejeitou saldo ausente sem confirmar o pedido.';
  raise notice 'PASS: CASE 2 rejeitou estoque insuficiente sem alterar saldo ou pagamento.';
  raise notice 'PASS: CASE 3 confirmou pagamento, baixou 1 unidade e registrou 1 movimento.';
  raise notice 'Todos os fixtures serão revertidos pelo ROLLBACK externo.';
end;
$test$;

rollback;
