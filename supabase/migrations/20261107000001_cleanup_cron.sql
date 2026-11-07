-- Daily 03:00 UTC: ask the api function to delete files older than the retention period.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('cleanup-old-files', '0 3 * * *', $$
  select net.http_post(
    url     := 'https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api',
    headers := '{"content-type": "application/json"}'::jsonb,
    body    := '{"action": "cleanup"}'::jsonb
  );
$$);
