-- Aset Life product authenticity codes.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.product_auth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_suffix text not null,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  lot_code text,
  active boolean not null default true,
  validation_count bigint not null default 0 check (validation_count >= 0),
  first_validated_at timestamptz,
  last_validated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists product_auth_codes_variant_created_idx on public.product_auth_codes(variant_id, created_at desc);
create index if not exists product_auth_codes_last_validation_idx on public.product_auth_codes(last_validated_at desc);
alter table public.product_auth_codes enable row level security;
revoke all on public.product_auth_codes from anon, authenticated;
grant select on public.product_auth_codes to authenticated;
drop policy if exists admin_all on public.product_auth_codes;
create policy admin_all on public.product_auth_codes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.admin_create_product_auth_codes(p_variant_id uuid, p_codes text[], p_lot_code text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_product_id uuid;
  v_code text;
  v_normalized text;
  v_count integer := 0;
  v_distinct integer;
  v_lot text := nullif(trim(p_lot_code), '');
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Acesso restrito ao administrador.'; end if;
  if p_variant_id is null then raise exception 'Selecione uma apresentação.'; end if;
  if p_codes is null or cardinality(p_codes) < 1 or cardinality(p_codes) > 500 then
    raise exception 'Informe de 1 a 500 códigos por operação.';
  end if;
  if v_lot is not null and length(v_lot) > 80 then raise exception 'O código do lote deve ter até 80 caracteres.'; end if;
  select pv.product_id into v_product_id
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where pv.id = p_variant_id and pv.active = true and p.active = true;
  if v_product_id is null then raise exception 'Produto ou apresentação inativa ou inexistente.'; end if;
  select count(distinct regexp_replace(upper(trim(t.code)), '[^A-Z0-9]', '', 'g')) into v_distinct
  from unnest(p_codes) as t(code);
  if v_distinct <> cardinality(p_codes) then raise exception 'A lista contém códigos repetidos.'; end if;
  foreach v_code in array p_codes loop
    v_normalized := regexp_replace(upper(trim(v_code)), '[^A-Z0-9]', '', 'g');
    if v_normalized !~ '^ASL[A-Z0-9]{16}$' then
      raise exception 'Formato inválido. Use ASL-XXXX-XXXX-XXXX-XXXX (16 caracteres aleatórios).';
    end if;
    insert into public.product_auth_codes(code_hash, code_suffix, product_id, variant_id, lot_code, created_by)
    values (encode(extensions.digest(v_normalized, 'sha256'), 'hex'), right(v_normalized, 4),
      v_product_id, p_variant_id, v_lot, auth.uid());
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('created', v_count);
exception when unique_violation then
  raise exception 'Um ou mais códigos já existem no sistema. Nenhum código desta operação foi importado.';
end;
$$;
revoke all on function public.admin_create_product_auth_codes(uuid, text[], text) from public, anon;
grant execute on function public.admin_create_product_auth_codes(uuid, text[], text) to authenticated;

create or replace function public.validate_product_auth_code(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_normalized text;
  v_code public.product_auth_codes%rowtype;
  v_product_name text;
  v_variant_name text;
begin
  v_normalized := regexp_replace(upper(trim(coalesce(p_code, ''))), '[^A-Z0-9]', '', 'g');
  if v_normalized !~ '^ASL[A-Z0-9]{16}$' then return jsonb_build_object('valid', false); end if;
  select * into v_code from public.product_auth_codes
  where code_hash = encode(extensions.digest(v_normalized, 'sha256'), 'hex') and active = true
  for update;
  if not found then return jsonb_build_object('valid', false); end if;
  update public.product_auth_codes
  set validation_count = validation_count + 1,
      first_validated_at = coalesce(first_validated_at, now()),
      last_validated_at = now()
  where id = v_code.id returning * into v_code;
  select p.name, pv.name into v_product_name, v_variant_name
  from public.products p join public.product_variants pv on pv.product_id = p.id
  where p.id = v_code.product_id and pv.id = v_code.variant_id;
  return jsonb_build_object(
    'valid', true, 'product_name', v_product_name, 'variant_name', v_variant_name,
    'lot_code', v_code.lot_code, 'validation_count', v_code.validation_count,
    'first_validation', v_code.validation_count = 1,
    'first_validated_at', v_code.first_validated_at, 'last_validated_at', v_code.last_validated_at
  );
end;
$$;
revoke all on function public.validate_product_auth_code(text) from public;
grant execute on function public.validate_product_auth_code(text) to anon, authenticated;
commit;
