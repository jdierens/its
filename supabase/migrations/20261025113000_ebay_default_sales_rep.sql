-- Default sales rep for new eBay drafts. Not a credential.
-- An empty value is MT. Apply by hand. Deploying does not run this file.

insert into public.app_settings (key, value)
values ('ebay_default_sales_rep', 'MT')
on conflict (key) do update
set value = excluded.value
where btrim(public.app_settings.value) = '';
