-- DJNP: Änderungen der anderen melden, unabhängig davon, ob die App offen bleibt.
-- Jede Änderung an einem gemeinsamen Eintrag landet in einer Warteschlange.
-- Der Erinnerungsdienst holt sie jede Minute ab und schickt eine kurze, gebündelte Nachricht.

create table if not exists public.change_queue (
  id         bigint generated always as identity primary key,
  author     text not null,
  item_id    text not null,
  kind       text not null,
  action     text not null,
  data       jsonb,
  visible_to text[],
  created_at timestamptz not null default now()
);
alter table public.change_queue enable row level security;
revoke all on public.change_queue from anon, authenticated;

create or replace function public.queue_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  who text := public.my_person();
  r   public.items;
  a   text;
  o   jsonb;
  n   jsonb;
begin
  if who is null then return null; end if;             -- changes made in the dashboard stay quiet
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if r.private or r.kind not in ('appt','shop','meal','task','away','doc','wish') then return null; end if;

  if tg_op = 'INSERT' then
    a := 'neu';
  elsif tg_op = 'DELETE' then
    if r.kind in ('shop','wish') then return null; end if;
    a := 'gelöscht';
  else
    if r.kind = 'shop' then return null; end if;       -- ticking off groceries stays quiet
    o := old.data; n := new.data;
    if r.kind = 'task' and coalesce((o->>'done')::boolean, false) = false and coalesce((n->>'done')::boolean, false) then
      a := 'erledigt';
    elsif r.kind = 'meal' and coalesce(o->'inv', '{}'::jsonb) <> coalesce(n->'inv', '{}'::jsonb)
          and coalesce(n->'inv', '{}'::jsonb) ? who and coalesce(n->>'by', '') <> who then
      a := 'antwort';
    elsif jsonb_array_length(coalesce(n->'photos', '[]'::jsonb)) > jsonb_array_length(coalesce(o->'photos', '[]'::jsonb)) then
      a := 'foto';
    elsif (o - 'done' - 'ts' - 'listed' - 'photos') is distinct from (n - 'done' - 'ts' - 'listed' - 'photos') then
      a := 'geändert';
    else
      return null;
    end if;
  end if;

  insert into public.change_queue (author, item_id, kind, action, data, visible_to)
  values (who, r.id, r.kind, a, r.data, r.visible_to);
  return null;
end $$;

revoke all on function public.queue_change() from public, anon, authenticated;

drop trigger if exists items_changes on public.items;
create trigger items_changes after insert or update or delete on public.items
  for each row execute function public.queue_change();

-- jede Minute abholen, aber nur wenn etwas wartet
select cron.unschedule(jobid) from cron.job where jobname = 'djnp-aenderungen';
select cron.schedule('djnp-aenderungen', '* * * * *', $$
  select net.http_post(
    url := 'https://hbohrdbqptfzhzqybbpc.supabase.co/functions/v1/erinnerungen?flush',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) where exists (select 1 from public.change_queue where created_at < now() - interval '20 seconds')
$$);
