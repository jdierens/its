-- Default payment terms and Incoterms for new eBay drafts. Not credentials.
-- Apply by hand. Deploying does not run this file.
-- Payment In Advance is the so_payment_terms code, the label, and the QuickBooks term name.

insert into public.so_payment_terms (code, label, qbo_term_name, sort_order)
values ('Payment In Advance', 'Payment In Advance', 'Payment In Advance', 5)
on conflict (code) do nothing;

insert into public.app_settings (key, value)
values
  ('ebay_default_payment_terms', 'Payment In Advance'),
  ('ebay_default_incoterms', 'FOB')
on conflict (key) do update
set value = excluded.value
where btrim(public.app_settings.value) = '';
