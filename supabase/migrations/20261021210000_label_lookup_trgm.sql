-- Speed up label search on item name and description. pg_trgm already lives
-- in the extensions schema, and items.sku already has a trigram index.
-- The search works without these indexes. Not applied.

create index if not exists items_name_trgm_idx
  on public.items using gin (name extensions.gin_trgm_ops);

create index if not exists items_description_trgm_idx
  on public.items using gin (description extensions.gin_trgm_ops);
