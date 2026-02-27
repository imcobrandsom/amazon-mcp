-- ============================================================
-- Bol.com Product Metadata — Manual flags and notes
-- Run this in Supabase SQL Editor (Project: Follo Marketplace)
-- ============================================================

-- ============================================================
-- TABLE: bol_product_metadata
-- Manual flags and metadata for products (EOL status, notes)
-- ============================================================
create table if not exists public.bol_product_metadata (
  id              uuid primary key default uuid_generate_v4(),
  bol_customer_id uuid not null references public.bol_customers(id) on delete cascade,
  ean             text not null,
  eol             boolean not null default false,
  notes           text,
  updated_at      timestamptz not null default now(),

  -- Prevent duplicate entries per customer+EAN
  unique(bol_customer_id, ean)
);

create index if not exists idx_bol_product_metadata_customer_ean
  on public.bol_product_metadata(bol_customer_id, ean);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.bol_product_metadata enable row level security;

create policy "bol_product_metadata_select" on public.bol_product_metadata
  for select to authenticated using (true);

create policy "bol_product_metadata_insert" on public.bol_product_metadata
  for insert to authenticated with check (true);

create policy "bol_product_metadata_update" on public.bol_product_metadata
  for update to authenticated using (true) with check (true);
