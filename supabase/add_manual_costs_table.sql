-- Run this once in the Supabase SQL Editor (project: qulbihqeiuupydhzvsao).
-- New table for the "Add Manual Cost" feature on Quote Detail — one-off
-- costs (name, description, flat dollar amount) that aren't captured by
-- the glass/labor pricing engine. Mirrors panes' RLS pattern: a tech can
-- manage manual costs on their own quotes, admins can manage all.

create table if not exists manual_costs (
  id          text primary key,
  quote_id    text not null references quotes(id) on delete cascade,
  name        text not null,
  description text not null default '',
  cost        numeric not null default 0,
  excluded    boolean not null default false,
  sort_order  integer not null default 0
);

alter table manual_costs enable row level security;

create policy "Techs manage manual costs on their own quotes"
  on manual_costs for all
  using (
    exists (
      select 1 from quotes
      where quotes.id = manual_costs.quote_id
        and quotes.tech_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from quotes
      where quotes.id = manual_costs.quote_id
        and quotes.tech_id = auth.uid()
    )
  );

create policy "Admins manage all manual costs"
  on manual_costs for all
  using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  )
  with check (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );
