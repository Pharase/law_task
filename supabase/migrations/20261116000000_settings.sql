-- Admin settings (members page → ตั้งค่า): notice times and bubble pictures, one jsonb row per key (see settings.ts).
create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table app_settings enable row level security;

-- Pictures shown in LINE bubbles: LINE fetches them, so this bucket is public (only admins can upload, via `api`).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('line-images', 'line-images', true, 1048576, array['image/jpeg', 'image/png']);

-- The send times are now chosen by admins, so both jobs run every 30 minutes all week; each action
-- checks the settings itself (the summary still goes once per day). Same job names = replaces the old schedules.
select cron.schedule('daily-digest', '5,35 * * * *', $$
  select net.http_post(
    url     := 'https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api',
    headers := '{"content-type": "application/json"}'::jsonb,
    body    := '{"action": "digest"}'::jsonb
  );
$$);
select cron.schedule('pending-notices', '0,30 * * * *', $$
  select net.http_post(
    url     := 'https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api',
    headers := '{"content-type": "application/json"}'::jsonb,
    body    := '{"action": "pendingNotices"}'::jsonb
  );
$$);
