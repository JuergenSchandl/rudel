-- Rudel: PDFs bei Dokumenten und Mitteilungen aufs Handy
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'bilder';

-- Welche Handys bekommen Mitteilungen? Jede Person verwaltet nur ihre eigenen Geräte.
create table if not exists public.push_subs (
  endpoint   text primary key,
  person     text not null check (person in ('d','j','n','p')),
  sub        jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
grant select, insert, update, delete on public.push_subs to authenticated;
drop policy if exists "eigene Geraete" on public.push_subs;
create policy "eigene Geraete" on public.push_subs for all to authenticated
  using (person = public.my_person()) with check (person = public.my_person());

-- Schlüssel und Versandprotokoll: nur der Erinnerungsdienst kommt da ran.
create table if not exists public.push_keys (
  id integer primary key, public_key text not null, private_key text not null
);
alter table public.push_keys enable row level security;
revoke all on public.push_keys from anon, authenticated;

create table if not exists public.push_log (
  key text primary key, sent_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;
