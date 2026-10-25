-- Default payment terms and Incoterms for new eBay drafts. Not credentials.
-- Apply by hand. Deploying does not run this file.
-- PIA is the so_payment_terms code. The label and the QuickBooks term name are Payment In Advance.

insert into public.so_payment_terms (code, label, qbo_term_name, sort_order)
values ('PIA', 'Payment In Advance', 'Payment In Advance', 5)
on conflict (code) do nothing;

insert into public.app_settings (key, value)
values
  ('ebay_default_payment_terms', 'PIA'),
  ('ebay_default_incoterms', 'FOB')
on conflict (key) do update
set value = case
  when public.app_settings.key = 'ebay_default_payment_terms'
    and btrim(public.app_settings.value) in ('', 'Payment In Advance') then 'PIA'
  else excluded.value
end
where btrim(public.app_settings.value) = ''
   or (
     public.app_settings.key = 'ebay_default_payment_terms'
     and btrim(public.app_settings.value) = 'Payment In Advance'
   );
