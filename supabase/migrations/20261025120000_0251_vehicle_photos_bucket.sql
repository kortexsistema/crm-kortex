-- Migration 0251: Bucket público de fotos de veículos para estoque automotivo
-- Criação do bucket 'vehicle-photos' no Supabase Storage
-- Leitura pública para exibição em vitrines, CRM e envio de links no WhatsApp
-- Limite de 5 MB por arquivo e tipos MIME permitidos: image/jpeg, image/png, image/webp

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehicle-photos',
  'vehicle-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura pública de objetos do bucket vehicle-photos
drop policy if exists "vehicle_photos_public_select" on storage.objects;
create policy "vehicle_photos_public_select" on storage.objects
  for select
  to public
  using (bucket_id = 'vehicle-photos');

-- Gravação e remoção gerenciadas pelo backend via service_role (bypass RLS)
-- ou gestores autenticados sob o path da sua própria organização
drop policy if exists "vehicle_photos_manager_insert" on storage.objects;
create policy "vehicle_photos_manager_insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] in (select public.fn_user_org_ids()::text)
  );

drop policy if exists "vehicle_photos_manager_delete" on storage.objects;
create policy "vehicle_photos_manager_delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] in (select public.fn_user_org_ids()::text)
  );
