-- Atomic order creation and payment confirmation.
begin;

create or replace function public.create_order_from_catalog(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text;
  v_customer_phone text;
  v_customer_email text;
  v_payment_method text;
  v_affiliate_ref text;
  v_affiliate_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2);
  v_item jsonb;
  v_variant_id uuid;
  v_quantity integer;
  v_unit_price numeric(12,2);
  v_product_name text;
  v_variant_name text;
  v_sku text;
  v_count integer := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload inválido.';
  end if;

  v_customer_name := nullif(trim(p_payload->>'customer_name'), '');
  v_customer_phone := nullif(trim(p_payload->>'customer_phone'), '');
  v_customer_email := nullif(trim(p_payload->>'customer_email'), '');
  v_payment_method := lower(coalesce(p_payload->>'payment_method', ''));
  v_affiliate_ref := nullif(upper(trim(p_payload->>'affiliate_ref')), '');

  if v_customer_name is null or length(v_customer_name) > 160 then
    raise exception 'Nome do cliente inválido.';
  end if;
  if v_customer_phone is null or length(regexp_replace(v_customer_phone, '[^0-9]', '', 'g')) < 10
     or length(regexp_replace(v_customer_phone, '[^0-9]', '', 'g')) > 15 then
    raise exception 'Telefone do cliente inválido.';
  end if;
  if v_customer_email is not null and length(v_customer_email) > 254 then
    raise exception 'E-mail inválido.';
  end if;
  if v_payment_method not in ('pix','transfer','cash','other') then
    raise exception 'Método de pagamento inválido.';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then
    raise exception 'A lista de itens do pedido é inválida.';
  end if;
  if jsonb_array_length(p_payload->'items') < 1
     or jsonb_array_length(p_payload->'items') > 50 then
    raise exception 'O pedido deve conter de 1 a 50 itens.';
  end if;

  if v_affiliate_ref is not null then
    select a.id into v_affiliate_id
    from public.affiliates a
    where upper(a.code) = v_affiliate_ref and a.active = true;
    if v_affiliate_id is null then
      raise exception 'Código de afiliado inválido ou inativo.';
    end if;
  end if;

  insert into public.orders(
    customer_name, customer_phone, customer_email, status, payment_status,
    subtotal, discount, total, affiliate_id, affiliate_ref, notes
  ) values (
    v_customer_name,
    regexp_replace(v_customer_phone, '[^0-9]', '', 'g'),
    v_customer_email,
    'pending_payment',
    'pending',
    0, 0, 0,
    v_affiliate_id,
    v_affiliate_ref,
    left(nullif(trim(p_payload->>'notes'), ''), 1000)
  ) returning id, order_number into v_order_id, v_order_number;

  for v_item in select value from jsonb_array_elements(p_payload->'items')
  loop
    v_count := v_count + 1;
    begin
      if jsonb_typeof(v_item) is distinct from 'object' then
        raise exception 'Item inválido.';
      end if;
      if coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' then
        raise exception 'Quantidade inválida.';
      end if;
      v_variant_id := (v_item->>'variant_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Item % possui variante ou quantidade inválida.', v_count;
    end;

    if v_quantity < 1 or v_quantity > 1000 then
      raise exception 'Quantidade inválida no item %.', v_count;
    end if;

    select pv.price, pv.name, pv.sku, p.name
      into v_unit_price, v_variant_name, v_sku, v_product_name
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = v_variant_id and pv.active = true and p.active = true
    for share of pv, p;

    if not found then
      raise exception 'Produto ou variante indisponível no item %.', v_count;
    end if;

    insert into public.order_items(
      order_id, variant_id, product_name_snapshot, variant_name_snapshot,
      sku_snapshot, unit_price, quantity, line_total
    ) values (
      v_order_id, v_variant_id, v_product_name, v_variant_name,
      v_sku, v_unit_price, v_quantity, round(v_unit_price * v_quantity, 2)
    );

    v_subtotal := v_subtotal + round(v_unit_price * v_quantity, 2);
  end loop;

  v_total := round(v_subtotal, 2);
  if v_total <= 0 then
    raise exception 'O total do pedido deve ser maior que zero.';
  end if;

  update public.orders
  set subtotal = v_subtotal, total = v_total
  where id = v_order_id;

  insert into public.payments(order_id, method, amount, status)
  values (v_order_id, v_payment_method, v_total, 'pending');

  insert into public.order_status_history(
    order_id, previous_status, new_status, reason, changed_by
  ) values (
    v_order_id, null, 'pending_payment', 'Pedido criado; aguardando confirmação manual do pagamento.', null
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'total', v_total,
    'status', 'pending_payment',
    'payment_status', 'pending'
  );
end;
$$;

revoke all on function public.create_order_from_catalog(jsonb) from public;
grant execute on function public.create_order_from_catalog(jsonb) to anon, authenticated;

create or replace function public.confirm_order_payment(
  p_order_id uuid,
  p_payment_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_line record;
  v_balance integer;
  v_commission_type text;
  v_commission_value numeric(12,2);
  v_commission_amount numeric(12,2);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Acesso restrito ao administrador.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_order.payment_status = 'confirmed' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'already_confirmed', true
    );
  end if;

  if v_order.status not in ('pending_payment','payment_issue')
     or v_order.payment_status <> 'pending' then
    raise exception 'O pedido não está aguardando confirmação de pagamento.';
  end if;

  select * into v_payment
  from public.payments
  where order_id = p_order_id and status = 'pending'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Pagamento pendente não encontrado.';
  end if;

  -- Aggregate duplicate variant lines and lock each balance before debiting.
  for v_line in
    select oi.variant_id, sum(oi.quantity)::integer as quantity
    from public.order_items oi
    where oi.order_id = p_order_id
    group by oi.variant_id
    order by oi.variant_id
  loop
    select ib.quantity_on_hand into v_balance
    from public.inventory_balances ib
    where ib.variant_id = v_line.variant_id
    for update;

    if not found then
      raise exception 'Estoque não cadastrado para uma ou mais variantes do pedido.';
    end if;
    if v_balance < v_line.quantity then
      raise exception 'Estoque insuficiente para uma ou mais variantes do pedido.';
    end if;

    update public.inventory_balances
    set quantity_on_hand = quantity_on_hand - v_line.quantity,
        updated_at = now()
    where variant_id = v_line.variant_id;

    insert into public.inventory_movements(
      variant_id, movement_type, quantity, reference_type, reference_id,
      notes, created_by
    ) values (
      v_line.variant_id, 'sale', v_line.quantity, 'order', p_order_id,
      'Baixa automática após confirmação do pagamento.', auth.uid()
    );
  end loop;

  update public.payments
  set status = 'confirmed',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      payment_reference = coalesce(nullif(trim(p_payment_reference), ''), payment_reference),
      notes = coalesce(nullif(trim(p_notes), ''), notes)
  where id = v_payment.id;

  update public.orders
  set status = 'paid',
      payment_status = 'confirmed'
  where id = p_order_id;

  insert into public.order_status_history(
    order_id, previous_status, new_status, reason, changed_by
  ) values (
    p_order_id, v_order.status, 'paid',
    'Pagamento confirmado pelo administrador; estoque baixado.', auth.uid()
  );

  if v_order.affiliate_id is not null then
    select a.commission_type, a.commission_value
      into v_commission_type, v_commission_value
    from public.affiliates a
    where a.id = v_order.affiliate_id and a.active = true;

    if found and v_commission_value > 0 then
      if v_commission_type = 'percent' then
        v_commission_amount := round(v_order.subtotal * v_commission_value / 100, 2);
      else
        v_commission_amount := v_commission_value;
      end if;

      if v_commission_amount > 0 then
        insert into public.affiliate_commissions(
          affiliate_id, order_id, base_amount, commission_amount, status
        ) values (
          v_order.affiliate_id, p_order_id, v_order.subtotal,
          v_commission_amount, 'pending'
        )
        on conflict(order_id) do nothing;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'status', 'paid',
    'payment_status', 'confirmed',
    'already_confirmed', false
  );
end;
$$;

revoke all on function public.confirm_order_payment(uuid, text, text) from public, anon;
grant execute on function public.confirm_order_payment(uuid, text, text) to authenticated;

commit;
