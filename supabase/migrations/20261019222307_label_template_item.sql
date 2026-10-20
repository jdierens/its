-- Additive. Copies the item label template into label_template_item.
-- The deployed app still reads label_template. A missing new key falls back to it.
-- Applied on fxsbpreasbdalwthyzvk as version 20261019222307.

insert into public.app_settings (key, value)
select 'label_template_item', value
from public.app_settings
where key = 'label_template'
on conflict (key) do nothing;

insert into public.app_settings (key, value)
values ('label_template_item', 'barcode')
on conflict (key) do nothing;

comment on table public.app_settings is
  'App key/value settings. Not credentials. pricing_sales_window_days is the sales window. label_template is the legacy item label template. label_template_item is the item label template and wins when it is set.';
