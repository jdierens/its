-- Adds items.product_url and normalize_product_url.
-- Applied on fxsbpreasbdalwthyzvk as version 20261020051707.

-- Adds items.product_url. create_item and update_item gain one optional text
-- argument at the end. Omitting it leaves the URL null on create and does not
-- change it on update. An empty string clears it. A value must be an http or
-- https URL.
alter table public.items
  add column product_url text;

comment on column public.items.product_url is
  'Optional http or https address of the product page.';

alter table public.items
  add constraint items_product_url_http
  check (
    product_url is null
    or product_url ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$'
  );

create or replace function public.normalize_product_url(p_value text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_text text;
begin
  v_text := nullif(btrim(coalesce(p_value, '')), '');
  if v_text is null then
    return null;
  end if;
  if v_text !~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$' then
    raise exception 'Product page must be an http or https URL' using errcode = '22023';
  end if;
  return v_text;
end;
$$;

revoke all on function public.normalize_product_url(text) from public;
grant execute on function public.normalize_product_url(text) to anon, authenticated, service_role;
