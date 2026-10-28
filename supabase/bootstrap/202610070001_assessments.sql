-- Apply in the Pires project. Authentication identities are managed by Supabase Auth.
begin;
create table if not exists public.pi_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('life', 'pmta', 'risk')),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 524288),
  report_text text not null check (octet_length(report_text) <= 220000),
  app_version text not null check (char_length(app_version) between 1 and 32),
  created_at timestamptz not null default now()
);
create index if not exists pi_assessments_owner_date on public.pi_assessments (user_id, created_at desc);
alter table public.pi_assessments enable row level security;
alter table public.pi_assessments force row level security;
revoke all on public.pi_assessments from anon, authenticated;
grant select, delete on public.pi_assessments to authenticated;
grant insert (id, user_id, kind, title, payload, report_text, app_version) on public.pi_assessments to authenticated;
drop policy if exists pi_assessments_select on public.pi_assessments;
create policy pi_assessments_select on public.pi_assessments for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists pi_assessments_insert on public.pi_assessments;
create policy pi_assessments_insert on public.pi_assessments for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists pi_assessments_delete on public.pi_assessments;
create policy pi_assessments_delete on public.pi_assessments for delete to authenticated
  using ((select auth.uid()) = user_id);
comment on table public.pi_assessments is 'Avaliações indicativas por usuário. Sem aprovação técnica automática. Cada gravação é um registro imutável; alterações geram nova avaliação.';
commit;
