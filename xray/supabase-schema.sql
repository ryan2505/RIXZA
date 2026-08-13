-- RIXZA X-Ray — lead capture table.
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → Run.
-- The engine writes with the SERVICE ROLE key, which bypasses Row Level Security,
-- so RLS stays on (locking out anon/public reads) while inserts still succeed.

create table if not exists public.xray_leads (
  id          bigint generated always as identity primary key,
  name        text,
  email       text,
  company     text,
  industry    text,
  website     text,
  score       int,
  level       text,
  source      text default 'xray',
  created_at  timestamptz default now()
);

-- Handy lookups for the CRM view.
create index if not exists xray_leads_created_at_idx on public.xray_leads (created_at desc);
create index if not exists xray_leads_email_idx      on public.xray_leads (email);

-- Lock the table down: only the service role (used server-side) can read/write.
alter table public.xray_leads enable row level security;
