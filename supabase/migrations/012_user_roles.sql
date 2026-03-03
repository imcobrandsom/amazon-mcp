-- ============================================================
-- User Roles & Access Control (admin / academy)
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- TABLE: user_profiles
-- Stores user roles (admin or academy). Default: academy.
-- ============================================================
create table if not exists public.user_profiles (
  id uuid primary key,
  role text not null default 'academy' check (role in ('admin', 'academy')),
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- Users can read their own profile
create policy "profiles_select_own" on public.user_profiles
  for select to authenticated using (auth.uid() = id);

-- ============================================================
-- HELPER FUNCTION: get_my_role()
-- Returns the role of the current user ('academy' if no row exists)
-- ============================================================
create or replace function public.get_my_role()
returns text language sql security definer stable as $$
  select coalesce(
    (select role from public.user_profiles where id = auth.uid()),
    'academy'
  );
$$;

-- ============================================================
-- UPDATE RLS POLICIES — Amazon Ads tables (admin only)
-- ============================================================

-- clients
drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_insert" on public.clients;
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_delete" on public.clients;
create policy "clients_select" on public.clients for select to authenticated using (public.get_my_role() = 'admin');
create policy "clients_insert" on public.clients for insert to authenticated with check (public.get_my_role() = 'admin');
create policy "clients_update" on public.clients for update to authenticated using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
create policy "clients_delete" on public.clients for delete to authenticated using (public.get_my_role() = 'admin');

-- client_markets
drop policy if exists "markets_select" on public.client_markets;
drop policy if exists "markets_insert" on public.client_markets;
drop policy if exists "markets_update" on public.client_markets;
drop policy if exists "markets_delete" on public.client_markets;
create policy "markets_select" on public.client_markets for select to authenticated using (public.get_my_role() = 'admin');
create policy "markets_insert" on public.client_markets for insert to authenticated with check (public.get_my_role() = 'admin');
create policy "markets_update" on public.client_markets for update to authenticated using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
create policy "markets_delete" on public.client_markets for delete to authenticated using (public.get_my_role() = 'admin');

-- agent_memory
drop policy if exists "memory_select" on public.agent_memory;
drop policy if exists "memory_insert" on public.agent_memory;
drop policy if exists "memory_update" on public.agent_memory;
drop policy if exists "memory_delete" on public.agent_memory;
create policy "memory_select" on public.agent_memory for select to authenticated using (public.get_my_role() = 'admin');
create policy "memory_insert" on public.agent_memory for insert to authenticated with check (public.get_my_role() = 'admin');
create policy "memory_update" on public.agent_memory for update to authenticated using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
create policy "memory_delete" on public.agent_memory for delete to authenticated using (public.get_my_role() = 'admin');

-- conversations
drop policy if exists "conv_select" on public.conversations;
drop policy if exists "conv_insert" on public.conversations;
drop policy if exists "conv_update" on public.conversations;
drop policy if exists "conv_delete" on public.conversations;
create policy "conv_select" on public.conversations for select to authenticated using (public.get_my_role() = 'admin');
create policy "conv_insert" on public.conversations for insert to authenticated with check (public.get_my_role() = 'admin');
create policy "conv_update" on public.conversations for update to authenticated using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
create policy "conv_delete" on public.conversations for delete to authenticated using (public.get_my_role() = 'admin');

-- messages
drop policy if exists "msg_select" on public.messages;
drop policy if exists "msg_insert" on public.messages;
drop policy if exists "msg_delete" on public.messages;
create policy "msg_select" on public.messages for select to authenticated using (public.get_my_role() = 'admin');
create policy "msg_insert" on public.messages for insert to authenticated with check (public.get_my_role() = 'admin');
create policy "msg_delete" on public.messages for delete to authenticated using (public.get_my_role() = 'admin');

-- optimization_proposals
drop policy if exists "proposals_select" on public.optimization_proposals;
drop policy if exists "proposals_insert" on public.optimization_proposals;
drop policy if exists "proposals_update" on public.optimization_proposals;
drop policy if exists "proposals_delete" on public.optimization_proposals;
create policy "proposals_select" on public.optimization_proposals for select to authenticated using (public.get_my_role() = 'admin');
create policy "proposals_insert" on public.optimization_proposals for insert to authenticated with check (public.get_my_role() = 'admin');
create policy "proposals_update" on public.optimization_proposals for update to authenticated using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
create policy "proposals_delete" on public.optimization_proposals for delete to authenticated using (public.get_my_role() = 'admin');

-- ============================================================
-- UPDATE RLS POLICIES — Bol.com tables (admin only)
-- ============================================================

-- bol_customers
drop policy if exists "bol_customers_select" on public.bol_customers;
drop policy if exists "bol_customers_insert" on public.bol_customers;
drop policy if exists "bol_customers_update" on public.bol_customers;
drop policy if exists "bol_customers_delete" on public.bol_customers;
create policy "bol_customers_select" on public.bol_customers for select to authenticated using (public.get_my_role() = 'admin');
create policy "bol_customers_insert" on public.bol_customers for insert to authenticated with check (public.get_my_role() = 'admin');
create policy "bol_customers_update" on public.bol_customers for update to authenticated using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
create policy "bol_customers_delete" on public.bol_customers for delete to authenticated using (public.get_my_role() = 'admin');

-- bol_sync_jobs
drop policy if exists "bol_sync_jobs_select" on public.bol_sync_jobs;
create policy "bol_sync_jobs_select" on public.bol_sync_jobs for select to authenticated using (public.get_my_role() = 'admin');

-- bol_raw_snapshots
drop policy if exists "bol_snapshots_select" on public.bol_raw_snapshots;
create policy "bol_snapshots_select" on public.bol_raw_snapshots for select to authenticated using (public.get_my_role() = 'admin');

-- bol_analyses
drop policy if exists "bol_analyses_select" on public.bol_analyses;
create policy "bol_analyses_select" on public.bol_analyses for select to authenticated using (public.get_my_role() = 'admin');

-- bol_campaign_performance (from migration 006)
drop policy if exists "bol_campaign_performance_select" on public.bol_campaign_performance;
create policy "bol_campaign_performance_select" on public.bol_campaign_performance for select to authenticated using (public.get_my_role() = 'admin');

-- bol_keyword_performance (from migration 006)
drop policy if exists "bol_keyword_performance_select" on public.bol_keyword_performance;
create policy "bol_keyword_performance_select" on public.bol_keyword_performance for select to authenticated using (public.get_my_role() = 'admin');

-- bol_competitor_snapshots (from migration 011)
drop policy if exists "bol_competitor_snapshots_select" on public.bol_competitor_snapshots;
create policy "bol_competitor_snapshots_select" on public.bol_competitor_snapshots for select to authenticated using (public.get_my_role() = 'admin');

-- bol_keyword_rankings (from migration 011)
drop policy if exists "bol_keyword_rankings_select" on public.bol_keyword_rankings;
create policy "bol_keyword_rankings_select" on public.bol_keyword_rankings for select to authenticated using (public.get_my_role() = 'admin');

-- bol_advertising_backfill_status (from migration 008)
drop policy if exists "bol_advertising_backfill_status_select" on public.bol_advertising_backfill_status;
create policy "bol_advertising_backfill_status_select" on public.bol_advertising_backfill_status for select to authenticated using (public.get_my_role() = 'admin');
