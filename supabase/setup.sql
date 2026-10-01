-- Sportify · global athlete recognition stats
-- Run this once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run.

-- 1) One row per athlete: how many times they were shown, how many times
--    players got them right, and the total answer time of the correct ones.
create table if not exists public.athlete_stats (
  athlete_id text primary key,
  seen       integer     not null default 0,
  correct    integer     not null default 0,
  total_ms   bigint      not null default 0,
  updated_at timestamptz not null default now()
);

-- Works whether or not "Automatically expose new tables" was ticked when the project was created.
grant usage on schema public to anon, authenticated;

-- 2) Anyone may read. Nobody may write directly — only through the function below.
alter table public.athlete_stats enable row level security;
drop policy if exists "public read" on public.athlete_stats;
create policy "public read" on public.athlete_stats
  for select to anon, authenticated using (true);
grant select on public.athlete_stats to anon, authenticated;
revoke insert, update, delete on public.athlete_stats from anon, authenticated;

-- 3) The only write path: add a batch of answers.
--    items = [{"id":"12371343","ok":true,"ms":1234}, ...]   (max 30 per call)
create or replace function public.record_answers(items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  n  integer := 0;
  ok boolean;
  ms integer;
begin
  if items is null or jsonb_typeof(items) <> 'array' then
    return 0;
  end if;
  for it in select value from jsonb_array_elements(items) limit 30 loop
    -- athlete ids are numeric registration numbers
    if coalesce(it->>'id', '') !~ '^[0-9]{3,10}$' then
      continue;
    end if;
    ok := coalesce(it->>'ok', 'false') = 'true';
    ms := case when ok and coalesce(it->>'ms', '') ~ '^[0-9]{1,9}(\.[0-9]+)?$'
               then least((it->>'ms')::numeric, 5000)::integer else 0 end;
    insert into public.athlete_stats as s (athlete_id, seen, correct, total_ms)
    values (it->>'id', 1, case when ok then 1 else 0 end, ms)
    on conflict (athlete_id) do update
      set seen       = s.seen + 1,
          correct    = s.correct + excluded.correct,
          total_ms   = s.total_ms + excluded.total_ms,
          updated_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.record_answers(jsonb) from public;
grant execute on function public.record_answers(jsonb) to anon, authenticated;
