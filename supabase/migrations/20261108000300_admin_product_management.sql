-- Secure product and variant management for authenticated administrators.
begin;

create or replace function public.admin_save_product(
  p_product_id uuid,
  p_product jsonb,
  p_category_id uuid,
  p_variants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_variant_name text;
  v_sku text;
  v_price numeric(12,2);
  v_active boolean;
  v_sort_order integer;
  v_count integer := 0;
  v_name text;
  v_legacy_id text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Acesso restrito ao administrador.';
  end if;

  if jsonb_typeof(p_product) is distinct from 'object'
     or jsonb_typeof(p_variants) is distinct from 'array' then
    raise exception 'Dados do produto ou apresentações inválidos.';
  end if;
  if jsonb_array_length(p_variants) > 50 then
    raise exception 'Cada produto pode ter no máximo 50 apresentações.';
  end if;

  v_name := nullif(trim(p_product->>'name'), '');
  if v_name is null or length(v_name) > 160 then
    raise exception 'Informe um nome de produto com até 160 caracteres.';
  end if;
  if p_category_id is null or not exists (
    select 1 from public.categories where id = p_category_id
  ) then
    raise exception 'Selecione uma categoria válida.';
  end if;

  v_legacy_id := nullif(trim(p_product->>'legacy_id'), '');
  if v_legacy_id is null then
    v_legacy_id := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'))
      || '-' || substr(gen_random_uuid()::text, 1, 8);
  end if;

  if p_product_id is null then
    insert into public.products(
      legacy_id, name, short_description, description, uses, evidence,
      disclaimer, active, sort_order
    ) values (
      v_legacy_id, v_name,
      nullif(trim(p_product->>'short_description'), ''),
      nullif(trim(p_product->>'description'), ''),
      nullif(trim(p_product->>'uses'), ''),
      nullif(trim(p_product->>'evidence'), ''),
      nullif(trim(p_product->>'disclaimer'), ''),
      coalesce((p_product->>'active')::boolean, true),
      coalesce((p_product->>'sort_order')::integer, 0)
    )
    returning id into v_product_id;
  else
    update public.products
    set legacy_id = v_legacy_id,
        name = v_name,
        short_description = nullif(trim(p_product->>'short_description'), ''),
        description = nullif(trim(p_product->>'description'), ''),
        uses = nullif(trim(p_product->>'uses'), ''),
        evidence = nullif(trim(p_product->>'evidence'), ''),
        disclaimer = nullif(trim(p_product->>'disclaimer'), ''),
        active = coalesce((p_product->>'active')::boolean, true),
        sort_order = coalesce((p_product->>'sort_order')::integer, 0)
    where id = p_product_id
    returning id into v_product_id;
    if v_product_id is null then
      raise exception 'Produto não encontrado.';
    end if;
  end if;

  delete from public.product_categories where product_id = v_product_id;
  insert into public.product_categories(product_id, category_id)
  values (v_product_id, p_category_id);

  -- Existing variants omitted from the submitted form are deactivated, never deleted.
  update public.product_variants
  set active = false
  where product_id = v_product_id;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    v_count := v_count + 1;
    v_variant_name := nullif(trim(v_variant->>'name'), '');
    begin
      v_price := (v_variant->>'price')::numeric(12,2);
      v_sort_order := coalesce((v_variant->>'sort_order')::integer, v_count - 1);
      v_active := coalesce((v_variant->>'active')::boolean, true);
      v_variant_id := nullif(v_variant->>'id', '')::uuid;
    exception when others then
      raise exception 'Dados inválidos na apresentação %.', v_count;
    end;

    if v_variant_name is null or length(v_variant_name) > 100
       or v_price is null or v_price < 0 then
      raise exception 'Informe nome e preço válido na apresentação %.', v_count;
    end if;
    v_sku := nullif(trim(v_variant->>'sku'), '');
    if v_sku is not null and length(v_sku) > 80 then
      raise exception 'SKU muito longo na apresentação %.', v_count;
    end if;

    if v_variant_id is null then
      insert into public.product_variants(
        product_id, name, sku, price, active, sort_order
      ) values (
        v_product_id, v_variant_name, v_sku, v_price, v_active, v_sort_order
      ) returning id into v_variant_id;

      insert into public.inventory_balances(variant_id, quantity_on_hand, low_stock_threshold)
      values (v_variant_id, 0, 3)
      on conflict (variant_id) do nothing;
    else
      update public.product_variants
      set name = v_variant_name,
          sku = v_sku,
          price = v_price,
          active = v_active,
          sort_order = v_sort_order
      where id = v_variant_id and product_id = v_product_id;
      if not found then
        raise exception 'Apresentação % não pertence a este produto.', v_count;
      end if;
    end if;
  end loop;

  return jsonb_build_object('product_id', v_product_id, 'variants_saved', v_count);
end;
$$;

revoke all on function public.admin_save_product(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.admin_save_product(uuid, jsonb, uuid, jsonb) to authenticated;

commit;
