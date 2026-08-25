-- 0010_fx_rates.sql
-- What: exchange rates to UZS (Central Bank of Uzbekistan feed + manual
--       fallback), used for display-currency conversion in analysis and
--       for the rating service USD rate.
-- Why:  statements come in different currencies; conversion uses the rate
--       at the statement period_end_date. CBU rates are cached here after
--       the first fetch; manual entries cover currencies/dates CBU lacks.

create type tci.fx_source as enum ('cbu', 'manual');

create table tci.fx_rates (
  id            uuid primary key default gen_random_uuid(),
  currency_code char(3) not null references tci.currencies (code),
  rate_to_uzs   numeric(18,6) not null check (rate_to_uzs > 0),
  rate_date     date not null,
  source        tci.fx_source not null,
  created_by    uuid references auth.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (currency_code, rate_date, source)
);

create index fx_rates_lookup_idx on tci.fx_rates (currency_code, rate_date);

alter table tci.fx_rates enable row level security;

create policy "fx_rates: staff all"
  on tci.fx_rates for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

grant select, insert, update, delete on tci.fx_rates to authenticated;
grant all on tci.fx_rates to service_role;
