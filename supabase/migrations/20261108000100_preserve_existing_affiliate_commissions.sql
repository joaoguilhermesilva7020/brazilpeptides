begin;

-- Keep commissions for orders attributed while the affiliate was active,
-- even if the affiliate is later deactivated before payment confirmation.
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
    where a.id = v_order.affiliate_id;

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
