-- Short-lived copy of Google Sheet tabs, so pages don't wait 1-3 s for Apps Script on every open.
-- One row per tab (so it stays tiny); used for 60 s, and deleted as soon as the app writes that tab. Only `api` touches it.
create table sheet_cache (
  tab        text primary key,
  rows       jsonb not null,
  cached_at  timestamptz not null default now()
);
alter table sheet_cache enable row level security;
