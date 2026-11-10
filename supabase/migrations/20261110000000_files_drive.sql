-- ส่งงาน files are copied to Google Drive (archive.ts); the copy's link outlives the 1-year Supabase copy.
alter table files add column drive_url text;
