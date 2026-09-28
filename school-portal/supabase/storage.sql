-- =====================================================================
-- EduNest: private file storage (run AFTER schema.sql)
-- Files live in two private buckets. The first folder of every path is the
-- school id, and a file can only be opened by people who can see the note
-- or message that owns it.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('notes', 'notes', false, 10485760, array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  ('chat', 'chat', false, 10485760, array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "edunest notes read" on storage.objects;
drop policy if exists "edunest notes upload" on storage.objects;
drop policy if exists "edunest notes delete" on storage.objects;
drop policy if exists "edunest chat read" on storage.objects;
drop policy if exists "edunest chat upload" on storage.objects;

create policy "edunest notes read" on storage.objects for select to authenticated
  using (bucket_id = 'notes'
         and (storage.foldername(name))[1] = (select public.auth_school())::text
         and exists (select 1 from public.note_files f where f.storage_path = storage.objects.name));

create policy "edunest notes upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'notes'
              and (storage.foldername(name))[1] = (select public.auth_school())::text
              and (select public.is_staff()));

create policy "edunest notes delete" on storage.objects for delete to authenticated
  using (bucket_id = 'notes'
         and (storage.foldername(name))[1] = (select public.auth_school())::text
         and (select public.is_staff()));

create policy "edunest chat read" on storage.objects for select to authenticated
  using (bucket_id = 'chat'
         and (storage.foldername(name))[1] = (select public.auth_school())::text
         and exists (select 1 from public.message_files f where f.storage_path = storage.objects.name));

create policy "edunest chat upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat'
              and (storage.foldername(name))[1] = (select public.auth_school())::text);
