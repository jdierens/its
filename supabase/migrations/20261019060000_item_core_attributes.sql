-- Core item columns, manufacturers, and trade-compliance fields.
-- Manufacturer is a controlled list. Country of origin has no default and starts empty.
-- Row level security on items is left off. New reference tables stay readable by the unsigned-in app.
-- Matching taxonomy attributes are copied and are not deleted.
-- Deploying this repository does not run this file. It is applied separately.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.collapse_label(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'), '');
$$;

create or replace function public.normalize_label(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(public.collapse_label(p_value)), '');
$$;

create table public.countries (
  alpha3 text primary key,
  alpha2 text not null,
  name text not null,
  constraint countries_alpha3_format check (alpha3 ~ '^[A-Z]{3}$'),
  constraint countries_alpha2_format check (alpha2 ~ '^[A-Z]{2}$'),
  constraint countries_alpha2_unique unique (alpha2)
);

comment on table public.countries is
  'ISO 3166-1 country reference. alpha3 is the country of origin code.';

insert into public.countries (alpha3, alpha2, name)
values
  ('AFG', 'AF', 'Afghanistan'),
  ('ALA', 'AX', 'Åland Islands'),
  ('ALB', 'AL', 'Albania'),
  ('DZA', 'DZ', 'Algeria'),
  ('ASM', 'AS', 'American Samoa'),
  ('AND', 'AD', 'Andorra'),
  ('AGO', 'AO', 'Angola'),
  ('AIA', 'AI', 'Anguilla'),
  ('ATA', 'AQ', 'Antarctica'),
  ('ATG', 'AG', 'Antigua and Barbuda'),
  ('ARG', 'AR', 'Argentina'),
  ('ARM', 'AM', 'Armenia'),
  ('ABW', 'AW', 'Aruba'),
  ('AUS', 'AU', 'Australia'),
  ('AUT', 'AT', 'Austria'),
  ('AZE', 'AZ', 'Azerbaijan'),
  ('BHS', 'BS', 'Bahamas'),
  ('BHR', 'BH', 'Bahrain'),
  ('BGD', 'BD', 'Bangladesh'),
  ('BRB', 'BB', 'Barbados'),
  ('BLR', 'BY', 'Belarus'),
  ('BEL', 'BE', 'Belgium'),
  ('BLZ', 'BZ', 'Belize'),
  ('BEN', 'BJ', 'Benin'),
  ('BMU', 'BM', 'Bermuda'),
  ('BTN', 'BT', 'Bhutan'),
  ('BOL', 'BO', 'Bolivia, Plurinational State of'),
  ('BES', 'BQ', 'Bonaire, Sint Eustatius and Saba'),
  ('BIH', 'BA', 'Bosnia and Herzegovina'),
  ('BWA', 'BW', 'Botswana'),
  ('BVT', 'BV', 'Bouvet Island'),
  ('BRA', 'BR', 'Brazil'),
  ('IOT', 'IO', 'British Indian Ocean Territory'),
  ('BRN', 'BN', 'Brunei Darussalam'),
  ('BGR', 'BG', 'Bulgaria'),
  ('BFA', 'BF', 'Burkina Faso'),
  ('BDI', 'BI', 'Burundi'),
  ('CPV', 'CV', 'Cabo Verde'),
  ('KHM', 'KH', 'Cambodia'),
  ('CMR', 'CM', 'Cameroon'),
  ('CAN', 'CA', 'Canada'),
  ('CYM', 'KY', 'Cayman Islands'),
  ('CAF', 'CF', 'Central African Republic'),
  ('TCD', 'TD', 'Chad'),
  ('CHL', 'CL', 'Chile'),
  ('CHN', 'CN', 'China'),
  ('CXR', 'CX', 'Christmas Island'),
  ('CCK', 'CC', 'Cocos (Keeling) Islands'),
  ('COL', 'CO', 'Colombia'),
  ('COM', 'KM', 'Comoros'),
  ('COG', 'CG', 'Congo'),
  ('COD', 'CD', 'Congo, Democratic Republic of the'),
  ('COK', 'CK', 'Cook Islands'),
  ('CRI', 'CR', 'Costa Rica'),
  ('CIV', 'CI', 'Côte d''Ivoire'),
  ('HRV', 'HR', 'Croatia'),
  ('CUB', 'CU', 'Cuba'),
  ('CUW', 'CW', 'Curaçao'),
  ('CYP', 'CY', 'Cyprus'),
  ('CZE', 'CZ', 'Czechia'),
  ('DNK', 'DK', 'Denmark'),
  ('DJI', 'DJ', 'Djibouti'),
  ('DMA', 'DM', 'Dominica'),
  ('DOM', 'DO', 'Dominican Republic'),
  ('ECU', 'EC', 'Ecuador'),
  ('EGY', 'EG', 'Egypt'),
  ('SLV', 'SV', 'El Salvador'),
  ('GNQ', 'GQ', 'Equatorial Guinea'),
  ('ERI', 'ER', 'Eritrea'),
  ('EST', 'EE', 'Estonia'),
  ('SWZ', 'SZ', 'Eswatini'),
  ('ETH', 'ET', 'Ethiopia'),
  ('FLK', 'FK', 'Falkland Islands (Malvinas)'),
  ('FRO', 'FO', 'Faroe Islands'),
  ('FJI', 'FJ', 'Fiji'),
  ('FIN', 'FI', 'Finland'),
  ('FRA', 'FR', 'France'),
  ('GUF', 'GF', 'French Guiana'),
  ('PYF', 'PF', 'French Polynesia'),
  ('ATF', 'TF', 'French Southern Territories'),
  ('GAB', 'GA', 'Gabon'),
  ('GMB', 'GM', 'Gambia'),
  ('GEO', 'GE', 'Georgia'),
  ('DEU', 'DE', 'Germany'),
  ('GHA', 'GH', 'Ghana'),
  ('GIB', 'GI', 'Gibraltar'),
  ('GRC', 'GR', 'Greece'),
  ('GRL', 'GL', 'Greenland'),
  ('GRD', 'GD', 'Grenada'),
  ('GLP', 'GP', 'Guadeloupe'),
  ('GUM', 'GU', 'Guam'),
  ('GTM', 'GT', 'Guatemala'),
  ('GGY', 'GG', 'Guernsey'),
  ('GIN', 'GN', 'Guinea'),
  ('GNB', 'GW', 'Guinea-Bissau'),
  ('GUY', 'GY', 'Guyana'),
  ('HTI', 'HT', 'Haiti'),
  ('HMD', 'HM', 'Heard Island and McDonald Islands'),
  ('VAT', 'VA', 'Holy See'),
  ('HND', 'HN', 'Honduras'),
  ('HKG', 'HK', 'Hong Kong'),
  ('HUN', 'HU', 'Hungary'),
  ('ISL', 'IS', 'Iceland'),
  ('IND', 'IN', 'India'),
  ('IDN', 'ID', 'Indonesia'),
  ('IRN', 'IR', 'Iran, Islamic Republic of'),
  ('IRQ', 'IQ', 'Iraq'),
  ('IRL', 'IE', 'Ireland'),
  ('IMN', 'IM', 'Isle of Man'),
  ('ISR', 'IL', 'Israel'),
  ('ITA', 'IT', 'Italy'),
  ('JAM', 'JM', 'Jamaica'),
  ('JPN', 'JP', 'Japan'),
  ('JEY', 'JE', 'Jersey'),
  ('JOR', 'JO', 'Jordan'),
  ('KAZ', 'KZ', 'Kazakhstan'),
  ('KEN', 'KE', 'Kenya'),
  ('KIR', 'KI', 'Kiribati'),
  ('PRK', 'KP', 'Korea, Democratic People''s Republic of'),
  ('KOR', 'KR', 'Korea, Republic of'),
  ('KWT', 'KW', 'Kuwait'),
  ('KGZ', 'KG', 'Kyrgyzstan'),
  ('LAO', 'LA', 'Lao People''s Democratic Republic'),
  ('LVA', 'LV', 'Latvia'),
  ('LBN', 'LB', 'Lebanon'),
  ('LSO', 'LS', 'Lesotho'),
  ('LBR', 'LR', 'Liberia'),
  ('LBY', 'LY', 'Libya'),
  ('LIE', 'LI', 'Liechtenstein'),
  ('LTU', 'LT', 'Lithuania'),
  ('LUX', 'LU', 'Luxembourg'),
  ('MAC', 'MO', 'Macao'),
  ('MDG', 'MG', 'Madagascar'),
  ('MWI', 'MW', 'Malawi'),
  ('MYS', 'MY', 'Malaysia'),
  ('MDV', 'MV', 'Maldives'),
  ('MLI', 'ML', 'Mali'),
  ('MLT', 'MT', 'Malta'),
  ('MHL', 'MH', 'Marshall Islands'),
  ('MTQ', 'MQ', 'Martinique'),
  ('MRT', 'MR', 'Mauritania'),
  ('MUS', 'MU', 'Mauritius'),
  ('MYT', 'YT', 'Mayotte'),
  ('MEX', 'MX', 'Mexico'),
  ('FSM', 'FM', 'Micronesia, Federated States of'),
  ('MDA', 'MD', 'Moldova, Republic of'),
  ('MCO', 'MC', 'Monaco'),
  ('MNG', 'MN', 'Mongolia'),
  ('MNE', 'ME', 'Montenegro'),
  ('MSR', 'MS', 'Montserrat'),
  ('MAR', 'MA', 'Morocco'),
  ('MOZ', 'MZ', 'Mozambique'),
  ('MMR', 'MM', 'Myanmar'),
  ('NAM', 'NA', 'Namibia'),
  ('NRU', 'NR', 'Nauru'),
  ('NPL', 'NP', 'Nepal'),
  ('NLD', 'NL', 'Netherlands, Kingdom of the'),
  ('NCL', 'NC', 'New Caledonia'),
  ('NZL', 'NZ', 'New Zealand'),
  ('NIC', 'NI', 'Nicaragua'),
  ('NER', 'NE', 'Niger'),
  ('NGA', 'NG', 'Nigeria'),
  ('NIU', 'NU', 'Niue'),
  ('NFK', 'NF', 'Norfolk Island'),
  ('MKD', 'MK', 'North Macedonia'),
  ('MNP', 'MP', 'Northern Mariana Islands'),
  ('NOR', 'NO', 'Norway'),
  ('OMN', 'OM', 'Oman'),
  ('PAK', 'PK', 'Pakistan'),
  ('PLW', 'PW', 'Palau'),
  ('PSE', 'PS', 'Palestine, State of'),
  ('PAN', 'PA', 'Panama'),
  ('PNG', 'PG', 'Papua New Guinea'),
  ('PRY', 'PY', 'Paraguay'),
  ('PER', 'PE', 'Peru'),
  ('PHL', 'PH', 'Philippines'),
  ('PCN', 'PN', 'Pitcairn'),
  ('POL', 'PL', 'Poland'),
  ('PRT', 'PT', 'Portugal'),
  ('PRI', 'PR', 'Puerto Rico'),
  ('QAT', 'QA', 'Qatar'),
  ('REU', 'RE', 'Réunion'),
  ('ROU', 'RO', 'Romania'),
  ('RUS', 'RU', 'Russian Federation'),
  ('RWA', 'RW', 'Rwanda'),
  ('BLM', 'BL', 'Saint Barthélemy'),
  ('SHN', 'SH', 'Saint Helena, Ascension and Tristan da Cunha'),
  ('KNA', 'KN', 'Saint Kitts and Nevis'),
  ('LCA', 'LC', 'Saint Lucia'),
  ('MAF', 'MF', 'Saint Martin (French part)'),
  ('SPM', 'PM', 'Saint Pierre and Miquelon'),
  ('VCT', 'VC', 'Saint Vincent and the Grenadines'),
  ('WSM', 'WS', 'Samoa'),
  ('SMR', 'SM', 'San Marino'),
  ('STP', 'ST', 'Sao Tome and Principe'),
  ('SAU', 'SA', 'Saudi Arabia'),
  ('SEN', 'SN', 'Senegal'),
  ('SRB', 'RS', 'Serbia'),
  ('SYC', 'SC', 'Seychelles'),
  ('SLE', 'SL', 'Sierra Leone'),
  ('SGP', 'SG', 'Singapore'),
  ('SXM', 'SX', 'Sint Maarten (Dutch part)'),
  ('SVK', 'SK', 'Slovakia'),
  ('SVN', 'SI', 'Slovenia'),
  ('SLB', 'SB', 'Solomon Islands'),
  ('SOM', 'SO', 'Somalia'),
  ('ZAF', 'ZA', 'South Africa'),
  ('SGS', 'GS', 'South Georgia and the South Sandwich Islands'),
  ('SSD', 'SS', 'South Sudan'),
  ('ESP', 'ES', 'Spain'),
  ('LKA', 'LK', 'Sri Lanka'),
  ('SDN', 'SD', 'Sudan'),
  ('SUR', 'SR', 'Suriname'),
  ('SJM', 'SJ', 'Svalbard and Jan Mayen'),
  ('SWE', 'SE', 'Sweden'),
  ('CHE', 'CH', 'Switzerland'),
  ('SYR', 'SY', 'Syrian Arab Republic'),
  ('TWN', 'TW', 'Taiwan, Province of China'),
  ('TJK', 'TJ', 'Tajikistan'),
  ('TZA', 'TZ', 'Tanzania, United Republic of'),
  ('THA', 'TH', 'Thailand'),
  ('TLS', 'TL', 'Timor-Leste'),
  ('TGO', 'TG', 'Togo'),
  ('TKL', 'TK', 'Tokelau'),
  ('TON', 'TO', 'Tonga'),
  ('TTO', 'TT', 'Trinidad and Tobago'),
  ('TUN', 'TN', 'Tunisia'),
  ('TUR', 'TR', 'Türkiye'),
  ('TKM', 'TM', 'Turkmenistan'),
  ('TCA', 'TC', 'Turks and Caicos Islands'),
  ('TUV', 'TV', 'Tuvalu'),
  ('UGA', 'UG', 'Uganda'),
  ('UKR', 'UA', 'Ukraine'),
  ('ARE', 'AE', 'United Arab Emirates'),
  ('GBR', 'GB', 'United Kingdom of Great Britain and Northern Ireland'),
  ('USA', 'US', 'United States of America'),
  ('UMI', 'UM', 'United States Minor Outlying Islands'),
  ('URY', 'UY', 'Uruguay'),
  ('UZB', 'UZ', 'Uzbekistan'),
  ('VUT', 'VU', 'Vanuatu'),
  ('VEN', 'VE', 'Venezuela, Bolivarian Republic of'),
  ('VNM', 'VN', 'Viet Nam'),
  ('VGB', 'VG', 'Virgin Islands (British)'),
  ('VIR', 'VI', 'Virgin Islands (U.S.)'),
  ('WLF', 'WF', 'Wallis and Futuna'),
  ('ESH', 'EH', 'Western Sahara'),
  ('YEM', 'YE', 'Yemen'),
  ('ZMB', 'ZM', 'Zambia'),
  ('ZWE', 'ZW', 'Zimbabwe')
;

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint manufacturers_name_present check (public.collapse_label(name) is not null)
);

create unique index manufacturers_name_norm_uidx
  on public.manufacturers (public.normalize_label(name));

comment on table public.manufacturers is
  'Controlled manufacturer names. Lookup is trimmed, case-insensitive, and ignores repeated spaces.';

create table public.manufacturer_aliases (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.manufacturers (id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  constraint manufacturer_aliases_present check (public.collapse_label(alias) is not null)
);

create unique index manufacturer_aliases_norm_uidx
  on public.manufacturer_aliases (public.normalize_label(alias));

create index manufacturer_aliases_manufacturer_idx
  on public.manufacturer_aliases (manufacturer_id);

comment on table public.manufacturer_aliases is
  'Alternate names that resolve to one manufacturer, such as Hynix for SK hynix.';

create or replace function public.manufacturers_name_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_norm text;
begin
  new.name := public.collapse_label(new.name);
  v_norm := public.normalize_label(new.name);
  if v_norm is null then
    raise exception 'Manufacturer name is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.manufacturer_aliases
    where public.normalize_label(alias) = v_norm
  ) then
    raise exception 'That name is already an alias' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger manufacturers_name_guard
  before insert or update of name on public.manufacturers
  for each row
  execute function public.manufacturers_name_guard();

create or replace function public.manufacturer_aliases_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_norm text;
begin
  new.alias := public.collapse_label(new.alias);
  v_norm := public.normalize_label(new.alias);
  if v_norm is null then
    raise exception 'Alias is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.manufacturers
    where public.normalize_label(name) = v_norm
  ) then
    raise exception 'That alias matches a manufacturer name' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger manufacturer_aliases_guard
  before insert or update of alias on public.manufacturer_aliases
  for each row
  execute function public.manufacturer_aliases_guard();

alter table public.items
  add column manufacturer_id uuid,
  add column model text,
  add column part_number text,
  add column condition text not null default 'Used',
  add column condition_note text,
  add column eccn text not null default '5A992.C',
  add column us_hts text,
  add column ccats text,
  add column coo text;

alter table public.items
  add constraint items_condition_known check (condition in ('New', 'Used')),
  add constraint items_condition_note_when_new check (
    condition <> 'New'
    or condition_note is null
    or condition_note in ('Factory Sealed', 'New Open Box')
  ),
  add constraint items_us_hts_format check (
    us_hts is null
    or (
      us_hts ~ '^[0-9]+(\.[0-9]+)*$'
      and length(regexp_replace(us_hts, '\D', '', 'g')) between 1 and 10
    )
  ),
  add constraint items_manufacturer_known
    foreign key (manufacturer_id) references public.manufacturers (id),
  add constraint items_coo_country
    foreign key (coo) references public.countries (alpha3);

create index items_manufacturer_idx on public.items (manufacturer_id);
create index items_coo_idx on public.items (coo);

comment on column public.items.manufacturer_id is 'Controlled manufacturer. Null when unknown.';
comment on column public.items.condition is 'New or Used. Defaults to Used.';
comment on column public.items.condition_note is
  'For New: Factory Sealed, New Open Box, or empty. For Used: optional free text.';
comment on column public.items.eccn is 'Export control classification. Defaults to 5A992.C.';
comment on column public.items.us_hts is 'US HTS code. Digits with optional dots, at most 10 digits.';
comment on column public.items.coo is 'Country of origin, ISO 3166-1 alpha-3. Empty until set. No default.';

insert into public.manufacturers (name)
select distinct on (public.normalize_label(ia.value))
  public.collapse_label(ia.value)
from public.item_attributes as ia
join public.attributes as fields on fields.id = ia.attribute_id
where lower(regexp_replace(fields.name, '[^[:alnum:]]', '', 'g')) in ('manufacturer', 'brand')
  and public.normalize_label(ia.value) is not null
order by public.normalize_label(ia.value), public.collapse_label(ia.value);

update public.items as items
set manufacturer_id = makers.id
from (
  select distinct on (ia.item_id)
    ia.item_id,
    public.normalize_label(ia.value) as norm
  from public.item_attributes as ia
  join public.attributes as fields on fields.id = ia.attribute_id
  where lower(regexp_replace(fields.name, '[^[:alnum:]]', '', 'g')) in ('manufacturer', 'brand')
    and public.normalize_label(ia.value) is not null
  order by ia.item_id,
    case lower(regexp_replace(fields.name, '[^[:alnum:]]', '', 'g'))
      when 'manufacturer' then 0
      else 1
    end,
    ia.attribute_id
) as copied
join public.manufacturers as makers
  on public.normalize_label(makers.name) = copied.norm
where items.id = copied.item_id
  and items.manufacturer_id is null;

update public.items as items
set model = copied.value
from (
  select distinct on (ia.item_id)
    ia.item_id,
    public.collapse_label(ia.value) as value
  from public.item_attributes as ia
  join public.attributes as fields on fields.id = ia.attribute_id
  where lower(regexp_replace(fields.name, '[^[:alnum:]]', '', 'g')) = 'model'
    and public.collapse_label(ia.value) is not null
  order by ia.item_id, ia.attribute_id
) as copied
where items.id = copied.item_id
  and items.model is null;

update public.items as items
set part_number = copied.value
from (
  select distinct on (ia.item_id)
    ia.item_id,
    public.collapse_label(ia.value) as value
  from public.item_attributes as ia
  join public.attributes as fields on fields.id = ia.attribute_id
  where lower(regexp_replace(fields.name, '[^[:alnum:]]', '', 'g')) in ('partnumber', 'mpn')
    and public.collapse_label(ia.value) is not null
  order by ia.item_id,
    case lower(regexp_replace(fields.name, '[^[:alnum:]]', '', 'g'))
      when 'partnumber' then 0
      else 1
    end,
    ia.attribute_id
) as copied
where items.id = copied.item_id
  and items.part_number is null;

update public.items as items
set condition = copied.value
from (
  select distinct on (ia.item_id)
    ia.item_id,
    case lower(btrim(ia.value))
      when 'new' then 'New'
      when 'used' then 'Used'
    end as value
  from public.item_attributes as ia
  join public.attributes as fields on fields.id = ia.attribute_id
  where lower(regexp_replace(fields.name, '[^[:alnum:]]', '', 'g')) = 'condition'
    and lower(btrim(ia.value)) in ('new', 'used')
  order by ia.item_id, ia.attribute_id
) as copied
where items.id = copied.item_id
  and copied.value is not null;

-- RLS stays off, matching items. The app has no login, so anon must read and write these rows.
alter table public.countries disable row level security;
alter table public.manufacturers disable row level security;
alter table public.manufacturer_aliases disable row level security;

grant all on table public.countries to anon, authenticated, service_role;
grant all on table public.manufacturers to anon, authenticated, service_role;
grant all on table public.manufacturer_aliases to anon, authenticated, service_role;

create or replace function public.prepare_item_core(
  p_manufacturer_id uuid,
  p_model text,
  p_part_number text,
  p_condition text,
  p_condition_note text,
  p_eccn text,
  p_us_hts text,
  p_ccats text,
  p_coo text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_model text := public.collapse_label(p_model);
  v_part_number text := public.collapse_label(p_part_number);
  v_condition text := nullif(btrim(coalesce(p_condition, '')), '');
  v_note text := nullif(btrim(coalesce(p_condition_note, '')), '');
  v_eccn text := nullif(btrim(coalesce(p_eccn, '')), '');
  v_hts text := nullif(btrim(coalesce(p_us_hts, '')), '');
  v_ccats text := nullif(btrim(coalesce(p_ccats, '')), '');
  v_coo text := nullif(upper(btrim(coalesce(p_coo, ''))), '');
begin
  if p_manufacturer_id is not null and not exists (
    select 1 from public.manufacturers where id = p_manufacturer_id
  ) then
    raise exception 'Choose a manufacturer from the list' using errcode = '23503';
  end if;

  if v_condition is null then
    v_condition := 'Used';
  elsif v_condition not in ('New', 'Used') then
    raise exception 'Condition must be New or Used' using errcode = '22023';
  end if;

  if v_condition = 'New' and v_note is not null and v_note not in ('Factory Sealed', 'New Open Box') then
    raise exception 'For a new item, the condition note must be Factory Sealed, New Open Box, or empty'
      using errcode = '22023';
  end if;

  if v_eccn is null then
    v_eccn := '5A992.C';
  end if;

  if v_hts is not null and (
    v_hts !~ '^[0-9]+(\.[0-9]+)*$'
    or length(regexp_replace(v_hts, '\D', '', 'g')) > 10
  ) then
    raise exception 'US HTS must be digits with optional dots and at most 10 digits'
      using errcode = '22023';
  end if;

  if v_coo is not null and not exists (select 1 from public.countries where alpha3 = v_coo) then
    raise exception 'Country of origin must be an ISO alpha-3 code' using errcode = '23503';
  end if;

  return jsonb_build_object(
    'manufacturer_id', p_manufacturer_id,
    'model', v_model,
    'part_number', v_part_number,
    'condition', v_condition,
    'condition_note', v_note,
    'eccn', v_eccn,
    'us_hts', v_hts,
    'ccats', v_ccats,
    'coo', v_coo
  );
end;
$$;

drop function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text);
drop function public.update_item(uuid, text, text, jsonb, text, text, bigint, jsonb, text, text);

create or replace function public.create_item(
  p_name text,
  p_taxonomy text,
  p_attributes jsonb,
  p_sku text,
  p_description text,
  p_quantity bigint,
  p_attribute_defs jsonb default '[]'::jsonb,
  p_long_code text default null,
  p_short_code text default null,
  p_manufacturer_id uuid default null,
  p_model text default null,
  p_part_number text default null,
  p_condition text default 'Used',
  p_condition_note text default null,
  p_eccn text default '5A992.C',
  p_us_hts text default null,
  p_ccats text default null,
  p_coo text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item_id uuid;
  v_taxonomy_id uuid;
  v_taxonomy_name text;
  v_cleaned jsonb := '{}'::jsonb;
  v_core jsonb;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  v_taxonomy_name := nullif(btrim(coalesce(p_taxonomy, '')), '');

  if v_taxonomy_name is null then
    if coalesce(p_attributes, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Attributes require a taxonomy' using errcode = '22023';
    end if;

    if jsonb_array_length(coalesce(p_attribute_defs, '[]'::jsonb)) > 0 then
      raise exception 'Choose a taxonomy before adding attributes' using errcode = '22023';
    end if;
  else
    select id
      into v_taxonomy_id
    from public.taxonomies
    where lower(name) = lower(v_taxonomy_name)
    limit 1;

    if v_taxonomy_id is null then
      v_taxonomy_id := public.insert_taxonomy(v_taxonomy_name, p_long_code, p_short_code);
    end if;

    v_cleaned := public.prepare_item_attributes(
      v_taxonomy_id,
      coalesce(p_attributes, '{}'::jsonb),
      coalesce(p_attribute_defs, '[]'::jsonb)
    );
  end if;

  v_core := public.prepare_item_core(
    p_manufacturer_id,
    p_model,
    p_part_number,
    p_condition,
    p_condition_note,
    p_eccn,
    p_us_hts,
    p_ccats,
    p_coo
  );

  insert into public.items (
    sku, name, description, taxonomy_id, quantity,
    manufacturer_id, model, part_number, condition, condition_note,
    eccn, us_hts, ccats, coo
  )
  values (
    coalesce(p_sku, ''),
    btrim(p_name),
    coalesce(p_description, ''),
    v_taxonomy_id,
    p_quantity,
    (v_core->>'manufacturer_id')::uuid,
    v_core->>'model',
    v_core->>'part_number',
    v_core->>'condition',
    v_core->>'condition_note',
    v_core->>'eccn',
    v_core->>'us_hts',
    v_core->>'ccats',
    v_core->>'coo'
  )
  returning id into v_item_id;

  insert into public.item_attributes (item_id, attribute_id, value)
  select v_item_id, fields.id, entry.value
  from jsonb_each_text(v_cleaned) as entry (key, value)
  join public.attributes as fields on fields.name = entry.key
  join public.taxonomy_attributes as links
    on links.attribute_id = fields.id
   and links.taxonomy_id = v_taxonomy_id;

  return v_item_id;
end;
$$;

create or replace function public.update_item(
  p_id uuid,
  p_name text,
  p_taxonomy text,
  p_attributes jsonb,
  p_sku text,
  p_description text,
  p_quantity bigint,
  p_attribute_defs jsonb default '[]'::jsonb,
  p_long_code text default null,
  p_short_code text default null,
  p_manufacturer_id uuid default null,
  p_model text default null,
  p_part_number text default null,
  p_condition text default 'Used',
  p_condition_note text default null,
  p_eccn text default '5A992.C',
  p_us_hts text default null,
  p_ccats text default null,
  p_coo text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_taxonomy_id uuid;
  v_taxonomy_name text;
  v_cleaned jsonb := '{}'::jsonb;
  v_core jsonb;
begin
  if p_id is null or not exists (select 1 from public.items where id = p_id) then
    raise exception 'Unknown item: %', p_id using errcode = 'P0002';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  v_taxonomy_name := nullif(btrim(coalesce(p_taxonomy, '')), '');

  if v_taxonomy_name is null then
    if coalesce(p_attributes, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Attributes require a taxonomy' using errcode = '22023';
    end if;

    if jsonb_array_length(coalesce(p_attribute_defs, '[]'::jsonb)) > 0 then
      raise exception 'Choose a taxonomy before adding attributes' using errcode = '22023';
    end if;
  else
    select id
      into v_taxonomy_id
    from public.taxonomies
    where lower(name) = lower(v_taxonomy_name)
    limit 1;

    if v_taxonomy_id is null then
      v_taxonomy_id := public.insert_taxonomy(v_taxonomy_name, p_long_code, p_short_code);
    end if;

    v_cleaned := public.prepare_item_attributes(
      v_taxonomy_id,
      coalesce(p_attributes, '{}'::jsonb),
      coalesce(p_attribute_defs, '[]'::jsonb)
    );
  end if;

  v_core := public.prepare_item_core(
    p_manufacturer_id,
    p_model,
    p_part_number,
    p_condition,
    p_condition_note,
    p_eccn,
    p_us_hts,
    p_ccats,
    p_coo
  );

  update public.items
  set
    sku = coalesce(p_sku, ''),
    name = btrim(p_name),
    description = coalesce(p_description, ''),
    taxonomy_id = v_taxonomy_id,
    quantity = p_quantity,
    manufacturer_id = (v_core->>'manufacturer_id')::uuid,
    model = v_core->>'model',
    part_number = v_core->>'part_number',
    condition = v_core->>'condition',
    condition_note = v_core->>'condition_note',
    eccn = v_core->>'eccn',
    us_hts = v_core->>'us_hts',
    ccats = v_core->>'ccats',
    coo = v_core->>'coo'
  where id = p_id;

  delete from public.item_attributes
  where item_id = p_id;

  insert into public.item_attributes (item_id, attribute_id, value)
  select p_id, fields.id, entry.value
  from jsonb_each_text(v_cleaned) as entry (key, value)
  join public.attributes as fields on fields.name = entry.key
  join public.taxonomy_attributes as links
    on links.attribute_id = fields.id
   and links.taxonomy_id = v_taxonomy_id;

  return p_id;
end;
$$;

create or replace function public.create_manufacturer(p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := public.collapse_label(p_name);
  v_norm text := public.normalize_label(p_name);
  v_id uuid;
begin
  if v_name is null or v_norm is null then
    raise exception 'Manufacturer name is required' using errcode = '22023';
  end if;

  select id into v_id
  from public.manufacturers
  where public.normalize_label(name) = v_norm;

  if v_id is null then
    select manufacturer_id into v_id
    from public.manufacturer_aliases
    where public.normalize_label(alias) = v_norm;
  end if;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.manufacturers (name)
  values (v_name)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rename_manufacturer(p_id uuid, p_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := public.collapse_label(p_name);
begin
  if v_name is null then
    raise exception 'Manufacturer name is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.manufacturers where id = p_id) then
    raise exception 'Manufacturer was not found' using errcode = 'P0002';
  end if;
  update public.manufacturers
  set name = v_name
  where id = p_id;
end;
$$;

create or replace function public.add_manufacturer_alias(p_manufacturer_id uuid, p_alias text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_alias text := public.collapse_label(p_alias);
  v_id uuid;
begin
  if v_alias is null then
    raise exception 'Alias is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.manufacturers where id = p_manufacturer_id) then
    raise exception 'Manufacturer was not found' using errcode = 'P0002';
  end if;
  insert into public.manufacturer_aliases (manufacturer_id, alias)
  values (p_manufacturer_id, v_alias)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.remove_manufacturer_alias(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.manufacturer_aliases where id = p_id;
end;
$$;

create or replace function public.merge_manufacturers(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_drop_name text;
  v_keep_norm text;
  v_drop_norm text;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different manufacturers' using errcode = '22023';
  end if;

  select public.normalize_label(name) into v_keep_norm
  from public.manufacturers where id = p_keep;
  select name, public.normalize_label(name) into v_drop_name, v_drop_norm
  from public.manufacturers where id = p_drop;

  if v_keep_norm is null or v_drop_name is null then
    raise exception 'Manufacturer was not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.manufacturer_aliases
    where public.normalize_label(alias) = v_drop_norm
      and manufacturer_id <> p_keep
      and manufacturer_id <> p_drop
  ) then
    raise exception 'That name is already an alias of another manufacturer' using errcode = '23505';
  end if;

  update public.items
  set manufacturer_id = p_keep
  where manufacturer_id = p_drop;

  delete from public.manufacturer_aliases as aliases
  where aliases.manufacturer_id = p_drop
    and (
      public.normalize_label(aliases.alias) = v_keep_norm
      or exists (
        select 1
        from public.manufacturer_aliases as kept
        where kept.manufacturer_id = p_keep
          and public.normalize_label(kept.alias) = public.normalize_label(aliases.alias)
      )
    );

  update public.manufacturer_aliases
  set manufacturer_id = p_keep
  where manufacturer_id = p_drop;

  delete from public.manufacturers where id = p_drop;

  if v_drop_norm is distinct from v_keep_norm and not exists (
    select 1
    from public.manufacturer_aliases
    where manufacturer_id = p_keep
      and public.normalize_label(alias) = v_drop_norm
  ) then
    insert into public.manufacturer_aliases (manufacturer_id, alias)
    values (p_keep, v_drop_name);
  end if;
end;
$$;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on function extensions.similarity(text, text) to anon, authenticated, service_role;
grant execute on function extensions.word_similarity(text, text) to anon, authenticated, service_role;

create or replace function public.suggest_manufacturers(p_query text)
returns table (id uuid, name text, matched text, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select public.normalize_label(p_query) as norm
  ),
  ranked as (
    select makers.id, makers.name, makers.name as matched, 1::real as score
    from public.manufacturers as makers
    cross join q
    where q.norm is not null
      and public.normalize_label(makers.name) = q.norm
    union all
    select makers.id, makers.name, aliases.alias, 0.99::real
    from public.manufacturer_aliases as aliases
    join public.manufacturers as makers on makers.id = aliases.manufacturer_id
    cross join q
    where q.norm is not null
      and public.normalize_label(aliases.alias) = q.norm
    union all
    select makers.id, makers.name, makers.name,
      greatest(
        extensions.similarity(public.normalize_label(makers.name), q.norm),
        extensions.word_similarity(q.norm, public.normalize_label(makers.name)),
        coalesce((
          select max(greatest(
            extensions.similarity(public.normalize_label(aliases.alias), q.norm),
            extensions.word_similarity(q.norm, public.normalize_label(aliases.alias))
          ))
          from public.manufacturer_aliases as aliases
          where aliases.manufacturer_id = makers.id
        ), 0::real)
      ) as score
    from public.manufacturers as makers
    cross join q
    where q.norm is not null
      and char_length(q.norm) >= 2
      and public.normalize_label(makers.name) is distinct from q.norm
      and not exists (
        select 1
        from public.manufacturer_aliases as aliases
        where aliases.manufacturer_id = makers.id
          and public.normalize_label(aliases.alias) = q.norm
      )
  )
  select ranked.id, ranked.name, ranked.matched, ranked.score
  from ranked
  where ranked.score >= 0.35
  order by ranked.score desc, ranked.name
  limit 8;
$$;

revoke all on function public.collapse_label(text) from public;
revoke all on function public.normalize_label(text) from public;
revoke all on function public.manufacturers_name_guard() from public;
revoke all on function public.manufacturer_aliases_guard() from public;
revoke all on function public.prepare_item_core(uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.update_item(uuid, text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.create_manufacturer(text) from public;
revoke all on function public.rename_manufacturer(uuid, text) from public;
revoke all on function public.add_manufacturer_alias(uuid, text) from public;
revoke all on function public.remove_manufacturer_alias(uuid) from public;
revoke all on function public.merge_manufacturers(uuid, uuid) from public;
revoke all on function public.suggest_manufacturers(text) from public;

grant execute on function public.collapse_label(text) to anon, authenticated, service_role;
grant execute on function public.normalize_label(text) to anon, authenticated, service_role;
grant execute on function public.manufacturers_name_guard() to anon, authenticated, service_role;
grant execute on function public.manufacturer_aliases_guard() to anon, authenticated, service_role;
grant execute on function public.prepare_item_core(uuid, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.update_item(uuid, text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.create_manufacturer(text) to anon, authenticated, service_role;
grant execute on function public.rename_manufacturer(uuid, text) to anon, authenticated, service_role;
grant execute on function public.add_manufacturer_alias(uuid, text) to anon, authenticated, service_role;
grant execute on function public.remove_manufacturer_alias(uuid) to anon, authenticated, service_role;
grant execute on function public.merge_manufacturers(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.suggest_manufacturers(text) to anon, authenticated, service_role;
