-- Invoice attachments live in Google Drive (<INVOICE_FOLDER_ID>/<date-building-subject-lawyer>/).
-- This private bucket only caches a copy to open in the app: path = <drive file id>/<last-modified ms>.<ext>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-files', 'invoice-files', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
