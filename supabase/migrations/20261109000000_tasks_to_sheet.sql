-- Tasks, sends and buildings now live in the Google Sheet (spec 2026-11-08-gsheet-storage-design.md).
-- These tables held only test data. Old attachment links are cleared first: sheet ids restart at 1,
-- so an old task_id would attach a test file to a real new task.
update files set task_id = null, send_id = null where task_id is not null or send_id is not null;
drop table task_sends, tasks, buildings cascade; -- cascade drops the files foreign keys; the integer columns stay

-- The summary now depends on Google: retry every 30 min until 11:35 Bangkok (02:05-04:35 UTC, Mon-Fri).
-- The action runs at most once per day, so the extra calls just answer "not now". Same name = replaces the job.
select cron.schedule('daily-digest', '5,35 2-4 * * 1-5', $$
  select net.http_post(
    url     := 'https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api',
    headers := '{"content-type": "application/json"}'::jsonb,
    body    := '{"action": "digest"}'::jsonb
  );
$$);
