-- ============================================================
-- Bol.com Marketplace Integration — Schema
-- Run this in Supabase SQL Editor (Project: Follo Marketplace)
-- ============================================================

-- ============================================================
-- TABLE: bol_customers
-- bol.com seller accounts, optionally linked to a Follo client
-- ============================================================
create table if not exists public.bol_customers (
  id                   uuid primary key default uuid_generate_v4(),
  client_id            uuid references public.clients(id) on delete set null, -- optional link to Follo client card
  seller_name          text not null,
  bol_client_id        text not null unique,
  bol_client_secret    text not null,   -- stored plaintext; protected by service_role + RLS
  active               boolean not null default true,
  sync_interval_hours  integer not null default 24 check (sync_interval_hours > 0),
  last_sync_at         timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists idx_bol_customers_client_id on public.bol_customers(client_id);
create index if not exists idx_bol_customers_active    on public.bol_customers(active) where active = true;

-- ============================================================
-- TABLE: bol_sync_jobs
-- Tracks async bol.com export jobs (2-step cron pattern)
-- ============================================================
create table if not exists public.bol_sync_jobs (
  id                 uuid primary key default uuid_generate_v4(),
  bol_customer_id    uuid not null references public.bol_customers(id) on delete cascade,
  data_type          text not null,            -- 'listings', 'inventory', 'orders', 'offer_insights'
  process_status_id  text,                     -- bol.com processStatusId (from step 1)
  entity_id          text,                     -- bol.com entityId (set when job completes)
  status             text not null default 'pending'
                       check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts           integer not null default 0,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  error              text,
  metadata           jsonb default '{}'
);

create index if not exists idx_bol_sync_jobs_status     on public.bol_sync_jobs(status) where status = 'pending';
create index if not exists idx_bol_sync_jobs_customer   on public.bol_sync_jobs(bol_customer_id, started_at desc);

-- ============================================================
-- TABLE: bol_raw_snapshots
-- Raw API responses stored as JSONB audit trail
-- ============================================================
create table if not exists public.bol_raw_snapshots (
  id               uuid primary key default uuid_generate_v4(),
  bol_customer_id  uuid not null references public.bol_customers(id) on delete cascade,
  data_type        text not null check (data_type in ('listings', 'inventory', 'orders', 'offer_insights')),
  raw_data         jsonb not null,
  record_count     integer default 0,
  quality_score    numeric(3,2) check (quality_score >= 0 and quality_score <= 1),
  fetched_at       timestamptz not null default now()
);

create index if not exists idx_bol_snapshots_customer_type on public.bol_raw_snapshots(bol_customer_id, data_type, fetched_at desc);

-- ============================================================
-- TABLE: bol_analyses
-- Processed per-category analysis results
-- ============================================================
create table if not exists public.bol_analyses (
  id               uuid primary key default uuid_generate_v4(),
  bol_customer_id  uuid not null references public.bol_customers(id) on delete cascade,
  snapshot_id      uuid references public.bol_raw_snapshots(id) on delete set null,
  category         text not null check (category in ('content', 'pricing', 'inventory', 'advertising')),
  score            integer check (score >= 0 and score <= 100),
  findings         jsonb not null default '{}',
  recommendations  jsonb not null default '[]',
  analyzed_at      timestamptz not null default now()
);

create index if not exists idx_bol_analyses_customer      on public.bol_analyses(bol_customer_id, analyzed_at desc);
create index if not exists idx_bol_analyses_category      on public.bol_analyses(bol_customer_id, category);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.bol_customers      enable row level security;
alter table public.bol_sync_jobs      enable row level security;
alter table public.bol_raw_snapshots  enable row level security;
alter table public.bol_analyses       enable row level security;

-- bol_customers: authenticated users can read; secret readable only via service_role
create policy "bol_customers_select" on public.bol_customers
  for select to authenticated using (true);
create policy "bol_customers_insert" on public.bol_customers
  for insert to authenticated with check (true);
create policy "bol_customers_update" on public.bol_customers
  for update to authenticated using (true) with check (true);
create policy "bol_customers_delete" on public.bol_customers
  for delete to authenticated using (true);

-- bol_sync_jobs: authenticated users can read (service_role writes from API)
create policy "bol_sync_jobs_select" on public.bol_sync_jobs
  for select to authenticated using (true);

-- bol_raw_snapshots: authenticated users can read
create policy "bol_snapshots_select" on public.bol_raw_snapshots
  for select to authenticated using (true);

-- bol_analyses: authenticated users can read
create policy "bol_analyses_select" on public.bol_analyses
  for select to authenticated using (true);
