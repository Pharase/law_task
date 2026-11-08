-- Daily LINE summary (spec "Notifications"): one push per person per Bangkok weekday at 09:00.
create table notify_log (
  id           bigint generated always as identity primary key,
  run_date     date not null,
  line_user_id text,               -- null = the run marker row for that day
  ok           boolean not null,
  error        text,               -- 'quota' when skipped for LINE quota
  created_at   timestamptz not null default now()
);
-- One marker per day: a second concurrent run fails to insert it and stops, so nobody gets two messages.
create unique index notify_log_one_run_per_day on notify_log (run_date) where line_user_id is null;
alter table notify_log enable row level security;

-- 02:05 UTC = 09:05 Bangkok, Mon–Fri. The action itself re-checks weekday/time and runs once per day.
select cron.schedule('daily-digest', '5 2 * * 1-5', $$
  select net.http_post(
    url     := 'https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api',
    headers := '{"content-type": "application/json"}'::jsonb,
    body    := '{"action": "digest"}'::jsonb
  );
$$);
