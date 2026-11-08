-- Task tracking (spec "Button A"). RLS on, no policies: only the `api` function (service role) reads/writes.

create table buildings (
  id   bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 1 and 200)
);

create table tasks (
  id                 bigint generated always as identity primary key,
  building_id        bigint not null references buildings(id),
  title              text not null check (char_length(title) between 1 and 200),
  details            text,
  tags               text[] not null check (
                       cardinality(tags) > 0 and
                       tags <@ array['ความถูกต้อง', 'เสนออนุมัติ/ลงนามกรรมการ', 'การประสานงาน', 'ติดตามความคืบหน้าคดี']),
  owner              text not null references profiles(line_user_id),
  state              text not null default 'on_process' check (state in ('on_process', 'submitted', 'approved', 'cancelled')),
  due_on             date not null,  -- original due date: decides the scoring period
  current_due_on     date not null,  -- moves with each มีปรับแก้
  fix_round          int  not null default 0,
  created_by         text not null references profiles(line_user_id),
  created_at         timestamptz not null default now(),
  member_notified_at timestamptz     -- set by the daily LINE summary
);
create index tasks_owner_state on tasks (owner, state);
create index tasks_state on tasks (state);

create table task_sends (
  id                 bigint generated always as identity primary key,
  task_id            bigint not null references tasks(id) on delete cascade,
  sent_on            date not null,  -- Bangkok date of the send
  sent_at            timestamptz not null default now(),
  due_on             date not null,  -- the due date this send answered
  outcome            text not null default 'pending' check (outcome in ('pending', 'approved', 'void', 'fix')),
  fix_note           text,
  next_due_on        date,
  reviewed_by        text references profiles(line_user_id),
  reviewed_at        timestamptz,
  member_notified_at timestamptz
);
create index task_sends_task on task_sends (task_id);

alter table files
  add column task_id      bigint references tasks(id),
  add column send_id      bigint references task_sends(id),
  add column backed_up_at timestamptz,
  add column backed_up_by text references profiles(line_user_id),
  add column deleted_at   timestamptz;
create index files_task on files (task_id);

alter table buildings  enable row level security;
alter table tasks      enable row level security;
alter table task_sends enable row level security;
