-- Amazon Ads OAuth credentials store (single-row table)
create table if not exists public.amazon_credentials (
  id integer primary key default 1,
  refresh_token text,
  access_token text,
  access_token_expires_at timestamptz,
  connected_at timestamptz,
  connected_by uuid references auth.users(id),
  constraint single_row check (id = 1)
);

alter table public.amazon_credentials enable row level security;

create policy "amazon_creds_select" on public.amazon_credentials
  for select to authenticated using (true);

create policy "amazon_creds_insert" on public.amazon_credentials
  for insert to authenticated with check (true);

create policy "amazon_creds_update" on public.amazon_credentials
  for update to authenticated using (true) with check (true);
