-- Home "ข่าวสาร · News": who has opened which news (unread = no row → dot next to the title). Only `api` touches it.
create table news_reads (
  line_user_id text not null,
  news_id      integer not null,
  read_at      timestamptz not null default now(),
  primary key (line_user_id, news_id)
);
alter table news_reads enable row level security;
