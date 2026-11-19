-- Invoice "new file" dot for admins: files a หัวหน้าทีม added to an invoice (admins' own uploads aren't recorded), and when
-- each admin last opened that invoice's 📎 panel. New = uploaded after that admin's seen_at (or never opened). Only `api` touches these.
create table invoice_uploads (
  id          bigint generated always as identity primary key,
  invoice_id  integer not null,
  file_name   text not null,
  by_name     text not null,
  uploaded_at timestamptz not null default now()
);
create index invoice_uploads_at on invoice_uploads (uploaded_at);
alter table invoice_uploads enable row level security;

create table invoice_seen (
  line_user_id text not null,
  invoice_id   integer not null,
  seen_at      timestamptz not null default now(),
  primary key (line_user_id, invoice_id)
);
alter table invoice_seen enable row level security;
