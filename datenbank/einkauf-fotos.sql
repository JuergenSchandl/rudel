-- DJNP: Produktfotos im Einkauf (Ordner shop/). Sichtbar nur für die, die den Einkaufs-Eintrag sehen.
alter policy "bilder lesen" on storage.objects using (
  bucket_id = 'bilder' and public.my_person() is not null
  and (storage.foldername(name))[1] in ('docs','meals','shop')
  and exists (select 1 from public.items i where i.id = (storage.foldername(name))[2])
);
alter policy "bilder hochladen" on storage.objects with check (
  bucket_id = 'bilder' and public.my_person() is not null
  and (storage.foldername(name))[1] in ('docs','meals','shop')
  and exists (select 1 from public.items i where i.id = (storage.foldername(name))[2])
);
