-- SyncNFe schema mínimo + RLS esqueleto
create extension if not exists "pgcrypto";

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null,
  email text not null,
  cnpj text,
  cnpj_pendente boolean not null default false,
  volume_mensal text not null,
  perfil text not null,
  lgpd_at timestamptz not null,
  origem text not null default 'hotsite',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  stage text not null default 'novo'
    check (stage in ('novo','teste','ativo','perdido')),
  account_id uuid,
  notes text
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_user_id uuid not null references auth.users(id),
  name text not null,
  plan_code text not null default 'free50',
  plan_status text not null default 'trialing',
  lead_id uuid references public.leads(id)
);

do $$ begin
  alter table public.leads
    add constraint leads_account_fk
    foreign key (account_id) references public.accounts(id);
exception when duplicate_object then null;
end $$;

create table if not exists public.establishments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  cnpj text not null,
  inscricao_municipal text,
  codigo_municipio_ibge text,
  channel text not null default 'nacional',
  channel_provider text,
  certificate_vault_ref text,
  certificate_expires_at timestamptz,
  active boolean not null default true,
  unique (account_id, cnpj)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  plan_code text not null,
  notes_quota int not null,
  price_brl numeric(10,2) not null,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  external_subscription_id text
);

create table if not exists public.quota_usage (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  period_yyyymm text not null,
  notes_used int not null default 0,
  notes_quota int not null,
  updated_at timestamptz not null default now(),
  unique (account_id, period_yyyymm)
);

create table if not exists public.nfse_docs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id),
  environment text not null,
  channel text not null,
  dps_id text,
  chave_acesso text,
  status text not null default 'pendente',
  rejection_code text,
  rejection_msg text,
  xml_storage_path text,
  emitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id),
  account_id uuid references public.accounts(id),
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_stage_idx on public.leads (stage);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists nfse_docs_account_created_idx on public.nfse_docs (account_id, created_at desc);
create index if not exists nfse_docs_chave_idx on public.nfse_docs (chave_acesso);

alter table public.leads enable row level security;
alter table public.accounts enable row level security;
alter table public.establishments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.quota_usage enable row level security;
alter table public.nfse_docs enable row level security;
alter table public.crm_events enable row level security;

-- Owner policies (service role bypasses RLS)
create or replace function public.is_account_owner(aid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accounts a
    where a.id = aid and a.owner_user_id = auth.uid()
  );
$$;

drop policy if exists accounts_owner_all on public.accounts;
create policy accounts_owner_all on public.accounts
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists establishments_owner_all on public.establishments;
create policy establishments_owner_all on public.establishments
  for all using (public.is_account_owner(account_id)) with check (public.is_account_owner(account_id));

drop policy if exists quota_usage_owner_all on public.quota_usage;
create policy quota_usage_owner_all on public.quota_usage
  for all using (public.is_account_owner(account_id)) with check (public.is_account_owner(account_id));

drop policy if exists nfse_docs_owner_all on public.nfse_docs;
create policy nfse_docs_owner_all on public.nfse_docs
  for all using (public.is_account_owner(account_id)) with check (public.is_account_owner(account_id));

drop policy if exists subscriptions_owner_select on public.subscriptions;
create policy subscriptions_owner_select on public.subscriptions
  for select using (public.is_account_owner(account_id));

drop policy if exists leads_owner_select on public.leads;
create policy leads_owner_select on public.leads
  for select using (account_id is not null and public.is_account_owner(account_id));

drop policy if exists crm_events_owner_select on public.crm_events;
create policy crm_events_owner_select on public.crm_events
  for select using (account_id is not null and public.is_account_owner(account_id));
