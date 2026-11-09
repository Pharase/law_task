-- New-task bubbles for tasks assigned outside 08:30–17:30 (or when LINE failed): every 30 minutes,
-- 08:00–17:30 Bangkok (01:00–10:30 UTC). The action itself only sends inside working hours and marks what it sent.
select cron.schedule('pending-notices', '0,30 1-10 * * *', $$
  select net.http_post(
    url     := 'https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api',
    headers := '{"content-type": "application/json"}'::jsonb,
    body    := '{"action": "pendingNotices"}'::jsonb
  );
$$);
