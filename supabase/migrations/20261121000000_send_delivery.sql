-- How the member delivered each send (chosen when pressing ส่งงาน): 'paper' = ส่งเอกสารตัวจริง, 'drive' = files in the
-- task's Drive folder (at least one uploaded after the previous send). send_id = the Sends tab row id. Only `api` touches it.
create table send_delivery (
  send_id    integer primary key,
  delivery   text not null check (delivery in ('paper', 'drive')),
  created_at timestamptz not null default now()
);
alter table send_delivery enable row level security;
