-- Additive. Inserts the label template setting. Missing or unknown values
-- stay on the barcode label, so the deployed app is unchanged.
-- Applied on fxsbpreasbdalwthyzvk as version 20261019213024.

insert into public.app_settings (key, value)
values ('label_template', 'barcode')
on conflict (key) do nothing;

comment on table public.app_settings is
  'App key/value settings. Not credentials. pricing_sales_window_days is the sales window. label_template is barcode or qr.';
