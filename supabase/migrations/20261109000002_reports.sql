-- Monthly reports: cached PDF copies of the files in the Google Drive report folder.
-- Object path = <drive file id>/<last-modified ms>.pdf, so a changed Drive file gets a fresh copy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 52428800, array['application/pdf']);
