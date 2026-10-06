-- =============================================================================
-- Production health monitor: what to watch, and what it saw last time.
--
-- Adding a row = watching something new, no redeploy.
-- Tokens are NEVER stored here: rows name the Edge Function secret that holds them.
-- RLS on, no policies: only the function (service_role) reads or writes.
-- =============================================================================

create table public.monitor_sites (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  url         text not null,
  -- A word that only appears when the page really loaded its data.
  expect_text text,
  active      boolean not null default true
);

create table public.monitor_whatsapp (
  id              bigint generated always as identity primary key,
  name            text not null,
  phone_number_id text not null unique,
  token_env       text not null default 'WHATSAPP_TOKEN',
  active          boolean not null default true
);

create table public.monitor_openai (
  id      bigint generated always as identity primary key,
  name    text not null unique,
  key_env text not null default 'OPENAI_API_KEY',
  active  boolean not null default true
);

create table public.monitor_state (
  key        text primary key,
  ok         boolean not null,
  detail     text not null,
  since      timestamptz not null,
  checked_at timestamptz not null
);

create table public.monitor_runs (
  id         bigint generated always as identity primary key,
  mode       text not null check (mode in ('daily', 'watch')),
  red        integer not null,
  summary    text,
  created_at timestamptz not null default now()
);

alter table public.monitor_sites    enable row level security;
alter table public.monitor_whatsapp enable row level security;
alter table public.monitor_openai   enable row level security;
alter table public.monitor_state    enable row level security;
alter table public.monitor_runs     enable row level security;

-- Failed pg_cron runs in the last 2 hours, by job name. Empty object when pg_cron is absent.
create function public.monitor_cron_failures()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if to_regclass('cron.job_run_details') is null then
    return '{}'::jsonb;
  end if;
  execute $q$
    select coalesce(jsonb_object_agg(jobname, failures), '{}'::jsonb)
      from (select j.jobname, count(*) as failures
              from cron.job_run_details d
              join cron.job j on j.jobid = d.jobid
             where d.status = 'failed' and d.start_time > now() - interval '2 hours'
             group by j.jobname) f
  $q$ into result;
  return result;
end;
$$;

-- Default grants give EXECUTE to PUBLIC, which includes the anon key.
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.monitor_cron_failures() to service_role;
