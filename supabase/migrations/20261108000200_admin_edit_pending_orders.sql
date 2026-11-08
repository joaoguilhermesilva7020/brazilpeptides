-- Allows administrators to revise an order only while its payment is pending.
begin;

create or replace function public.admin_update_pending_order(
  p_order_id uuid,
  p_items jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_payment_count integer;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity integer;
  v_unit_price numeric(12,2);
  v_product_name text;
  v_variant_name text;
  v_sku text;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2);
  v_old_items text;
  v_new_items text;
  v_count integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Acesso restrito ao administrador.';
  end if;

  if p_order_id is null then
    raise exception 'Pedido inválido.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 50 then
    raise exception 'O pedido deve conter de 1 a 50 itens.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_order.payment_status <> 'pending'
     or v_order.status not in ('pending_payment', 'payment_issue') then
    raise exception 'Somente pedidos aguardando pagamento podem ser editados.';
  end if;

  if exists (
    select 1 from public.payments
    where order_id = p_order_id and status = 'confirmed'
  ) then
    raise exception 'Este pedido possui pagamento confirmado e não pode ser editado.';
  end if;

  select count(*) into v_payment_count
  from public.payments
  where order_id = p_order_id and status = 'pending'
  for update;

  if v_payment_count = 0 then
    raise exception 'Pagamento pendente não encontrado para este pedido.';
  end if;

  select string_agg(
    oi.product_name_snapshot || ' / ' || oi.variant_name_snapshot || ' x' || oi.quantity,
    '; ' order by oi.created_at
  ) into v_old_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  delete from public.order_items where order_id = p_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    begin
      if jsonb_typeof(v_item) is distinct from 'object'
         or coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' then
        raise exception 'Item ou quantidade inválida.';
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
    where pv.id = v_variant_id
      and pv.active = true
      and p.active = true
    for share of pv, p;

    if not found then
      raise exception 'Produto ou variante indisponível no item %.', v_count;
    end if;

    insert into public.order_items(
      order_id, variant_id, product_name_snapshot, variant_name_snapshot,
      sku_snapshot, unit_price, quantity, line_total
    ) values (
      p_order_id, v_variant_id, v_product_name, v_variant_name,
      v_sku, v_unit_price, v_quantity, round(v_unit_price * v_quantity, 2)
    );

    v_subtotal := v_subtotal + round(v_unit_price * v_quantity, 2);
  end loop;

  if v_subtotal <= 0 then
    raise exception 'O subtotal do pedido deve ser maior que zero.';
  end if;

  if v_order.discount > v_subtotal then
    raise exception 'O desconto atual é maior que o novo subtotal; ajuste o desconto antes de salvar.';
  end if;

  v_total := round(v_subtotal - v_order.discount, 2);
  if v_total <= 0 then
    raise exception 'O total do pedido deve ser maior que zero.';
  end if;

  update public.orders
  set subtotal = v_subtotal,
      total = v_total,
      updated_at = now()
  where id = p_order_id;

  update public.payments
  set amount = v_total
  where order_id = p_order_id and status = 'pending';

  select string_agg(
    oi.product_name_snapshot || ' / ' || oi.variant_name_snapshot || ' x' || oi.quantity,
    '; ' order by oi.created_at
  ) into v_new_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  insert into public.order_status_history(
    order_id, previous_status, new_status, reason, changed_by
  ) values (
    p_order_id,
    v_order.status,
    v_order.status,
    left(
      coalesce(nullif(trim(p_reason), ''), 'Pedido editado pelo administrador antes do pagamento.')
      || ' Itens anteriores: ' || coalesce(v_old_items, 'nenhum')
      || '. Itens atualizados: ' || coalesce(v_new_items, 'nenhum')
      || '. Total anterior: R$ ' || v_order.total
      || '; novo total: R$ ' || v_total || '.',
      2000
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'subtotal', v_subtotal,
    'discount', v_order.discount,
    'total', v_total,
    'payment_status', 'pending'
  );
end;
$$;

revoke all on function public.admin_update_pending_order(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_update_pending_order(uuid, jsonb, text) to authenticated;

commit;
