-- Tasks, sends and buildings now live in the Google Sheet (spec 2026-11-08-gsheet-storage-design.md).
-- These tables held only test data. Old attachment links are cleared first: sheet ids restart at 1,
-- so an old task_id would attach a test file to a real new task.
update files set task_id = null, send_id = null where task_id is not null or send_id is not null;
drop table task_sends, tasks, buildings cascade; -- cascade drops the files foreign keys; the integer columns stay
