-- Rudel Familien-App: Tabellen und Zugriffsregeln
-- Einmal im SQL-Editor von Supabase ausführen. Kann gefahrlos wiederholt werden.

-- Wer gehört zur Familie und welche Person ist das? (d = Dagmar, j = Jürgen, n = Nina, p = Philip)
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  person  text not null unique check (person in ('d','j','n','p'))
);

-- Jeder Eintrag der App ist eine Zeile: ein Termin, ein Einkauf, ein Essen, eine Messung ...
create table if not exists public.items (
  id          text primary key,
  kind        text not null,
  data        jsonb not null,
  owner       text,                      -- Person, der der Eintrag gehört (Pflicht bei privaten Einträgen)
  private     boolean not null default false,
  visible_to  text[],                    -- leer = alle in der Familie
  updated_at  timestamptz not null default now(),
  updated_by  text,
  constraint private_needs_owner check (private = false or owner is not null)
);
create index if not exists items_kind_idx on public.items (kind);

alter table public.members enable row level security;
alter table public.items   enable row level security;

-- Welche Person ist das angemeldete Konto?
create or replace function public.my_person()
returns text language sql stable security definer set search_path = public
as $$ select person from public.members where user_id = auth.uid() $$;

revoke all on function public.my_person() from public, anon;
grant execute on function public.my_person() to authenticated;

grant select on public.members to authenticated;
grant select, insert, update, delete on public.items to authenticated;

drop policy if exists "Familie sieht die Zuordnung" on public.members;
create policy "Familie sieht die Zuordnung" on public.members
  for select to authenticated using (public.my_person() is not null);

-- Lesen: Gemeinsames sieht die Familie, Privates nur die Person selbst,
-- eingeschränkte Einträge (z. B. Dokumente) nur die Freigegebenen.
drop policy if exists "lesen" on public.items;
create policy "lesen" on public.items for select to authenticated using (
  public.my_person() is not null and (
    owner = public.my_person()
    or (private = false and (visible_to is null or public.my_person() = any (visible_to)))
  )
);

drop policy if exists "anlegen" on public.items;
create policy "anlegen" on public.items for insert to authenticated with check (
  public.my_person() is not null and (private = false or owner = public.my_person())
);

drop policy if exists "aendern" on public.items;
create policy "aendern" on public.items for update to authenticated using (
  public.my_person() is not null and (
    owner = public.my_person()
    or (private = false and (visible_to is null or public.my_person() = any (visible_to)))
  )
) with check (
  public.my_person() is not null and (private = false or owner = public.my_person())
);

drop policy if exists "loeschen" on public.items;
create policy "loeschen" on public.items for delete to authenticated using (
  public.my_person() is not null and (
    owner = public.my_person()
    or (private = false and (visible_to is null or public.my_person() = any (visible_to)))
  )
);

-- Änderungen live an alle Geräte schicken
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items') then
    alter publication supabase_realtime add table public.items;
  end if;
end $$;
