-- Follo Marketplace AI Platform — Initial Schema
-- Run this in your Supabase SQL editor

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- clients
create table if not exists public.clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  logo_url text,
  created_at timestamptz not null default now()
);

-- client_markets
create table if not exists public.client_markets (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  country_code text not null,           -- e.g. NL, DE, FR
  amazon_advertiser_profile_id text not null,
  amazon_advertiser_account_id text not null,
  roas_target numeric(8,2),
  daily_budget_cap numeric(12,2),
  currency text not null default 'EUR',
  state text not null default 'active' check (state in ('active','paused')),
  notes text,
  created_at timestamptz not null default now()
);

-- agent_memory
create table if not exists public.agent_memory (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  memory_type text not null check (memory_type in ('goal','rule','decision','note')),
  content text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  is_active boolean not null default true
);

-- conversations
create table if not exists public.conversations (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  market_id uuid references public.client_markets(id) on delete set null,
  user_id uuid references auth.users(id),
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- messages
create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

-- optimization_proposals
create table if not exists public.optimization_proposals (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  market_id uuid references public.client_markets(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null,
  description text,
  proposal_type text not null check (proposal_type in ('bid','budget','keyword','targeting')),
  current_value text,
  proposed_value text,
  expected_impact text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed')),
  created_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  executed_at timestamptz,
  amazon_api_payload jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_client_markets_client_id on public.client_markets(client_id);
create index if not exists idx_agent_memory_client_id on public.agent_memory(client_id);
create index if not exists idx_agent_memory_is_active on public.agent_memory(is_active);
create index if not exists idx_conversations_client_id on public.conversations(client_id);
create index if not exists idx_conversations_updated_at on public.conversations(updated_at desc);
create index if not exists idx_messages_conversation_id on public.messages(conversation_id);
create index if not exists idx_messages_created_at on public.messages(created_at);
create index if not exists idx_proposals_client_id on public.optimization_proposals(client_id);
create index if not exists idx_proposals_market_id on public.optimization_proposals(market_id);
create index if not exists idx_proposals_status on public.optimization_proposals(status);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
alter table public.clients enable row level security;
alter table public.client_markets enable row level security;
alter table public.agent_memory enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.optimization_proposals enable row level security;

-- Helper: restrict to authenticated @folloagency.com users
-- Note: domain check is enforced at app level and via Supabase Auth config.
-- RLS policies allow any authenticated user (domain restriction via OAuth).

-- clients — authenticated users can read/write
create policy "clients_select" on public.clients for select to authenticated using (true);
create policy "clients_insert" on public.clients for insert to authenticated with check (true);
create policy "clients_update" on public.clients for update to authenticated using (true) with check (true);
create policy "clients_delete" on public.clients for delete to authenticated using (true);

-- client_markets
create policy "markets_select" on public.client_markets for select to authenticated using (true);
create policy "markets_insert" on public.client_markets for insert to authenticated with check (true);
create policy "markets_update" on public.client_markets for update to authenticated using (true) with check (true);
create policy "markets_delete" on public.client_markets for delete to authenticated using (true);

-- agent_memory
create policy "memory_select" on public.agent_memory for select to authenticated using (true);
create policy "memory_insert" on public.agent_memory for insert to authenticated with check (auth.uid() = created_by);
create policy "memory_update" on public.agent_memory for update to authenticated using (true) with check (true);
create policy "memory_delete" on public.agent_memory for delete to authenticated using (true);

-- conversations
create policy "conv_select" on public.conversations for select to authenticated using (true);
create policy "conv_insert" on public.conversations for insert to authenticated with check (auth.uid() = user_id);
create policy "conv_update" on public.conversations for update to authenticated using (true) with check (true);
create policy "conv_delete" on public.conversations for delete to authenticated using (auth.uid() = user_id);

-- messages
create policy "msg_select" on public.messages for select to authenticated using (true);
create policy "msg_insert" on public.messages for insert to authenticated with check (true);
create policy "msg_delete" on public.messages for delete to authenticated using (true);

-- optimization_proposals
create policy "proposals_select" on public.optimization_proposals for select to authenticated using (true);
create policy "proposals_insert" on public.optimization_proposals for insert to authenticated with check (auth.uid() = created_by);
create policy "proposals_update" on public.optimization_proposals for update to authenticated using (true) with check (true);
create policy "proposals_delete" on public.optimization_proposals for delete to authenticated using (true);

-- ============================================================
-- SEED DATA (optional demo)
-- ============================================================

-- Uncomment to insert a sample client for testing:
-- insert into public.clients (name) values ('Bloomique');
