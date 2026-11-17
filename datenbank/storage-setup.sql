-- Rudel: Fotos für Dokumente und Essen
-- Privater Speicher "bilder". Ein Foto sieht nur, wer den zugehörigen Eintrag sehen darf.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bilder', 'bilder', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Die Unterabfrage auf public.items läuft mit den Rechten der angemeldeten Person,
-- also gelten dort dieselben Leseregeln wie in der App.
drop policy if exists "bilder lesen" on storage.objects;
create policy "bilder lesen" on storage.objects for select to authenticated using (
  bucket_id = 'bilder' and public.my_person() is not null
  and (storage.foldername(name))[1] in ('docs','meals')
  and exists (select 1 from public.items i where i.id = (storage.foldername(name))[2])
);
drop policy if exists "bilder hochladen" on storage.objects;
create policy "bilder hochladen" on storage.objects for insert to authenticated with check (
  bucket_id = 'bilder' and public.my_person() is not null
  and (storage.foldername(name))[1] in ('docs','meals')
  and exists (select 1 from public.items i where i.id = (storage.foldername(name))[2])
);
drop policy if exists "bilder loeschen" on storage.objects;
create policy "bilder loeschen" on storage.objects for delete to authenticated using (
  bucket_id = 'bilder' and public.my_person() is not null
  and exists (select 1 from public.items i where i.id = (storage.foldername(name))[2])
);
