-- Admin-only atomic stock entries.
begin;

create or replace function public.register_inventory_entry(
  p_variant_id uuid,
  p_quantity integer,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
  v_movement_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Acesso restrito ao administrador.';
  end if;

  if p_variant_id is null then
    raise exception 'Selecione uma variante válida.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'A quantidade deve ser um número inteiro entre 1 e 100000.';
  end if;

  if not exists (
    select 1
    from public.product_variants pv
    where pv.id = p_variant_id
  ) then
    raise exception 'Variante não encontrada.';
  end if;

  insert into public.inventory_balances(variant_id, quantity_on_hand)
  values (p_variant_id, p_quantity)
  on conflict (variant_id)
  do update set
    quantity_on_hand = inventory_balances.quantity_on_hand + excluded.quantity_on_hand,
    updated_at = now()
  returning quantity_on_hand into v_balance;

  insert into public.inventory_movements(
    variant_id, movement_type, quantity, reference_type, notes, created_by
  ) values (
    p_variant_id,
    'entry',
    p_quantity,
    'admin_entry',
    left(nullif(trim(p_notes), ''), 500),
    auth.uid()
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'variant_id', p_variant_id,
    'quantity_added', p_quantity,
    'quantity_on_hand', v_balance,
    'movement_id', v_movement_id
  );
end;
$$;

revoke all on function public.register_inventory_entry(uuid, integer, text) from public, anon;
grant execute on function public.register_inventory_entry(uuid, integer, text) to authenticated;

commit;
