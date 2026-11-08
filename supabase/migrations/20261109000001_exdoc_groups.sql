-- Ex Doc groups: admins define groups and put each document in one (or none = "อื่นๆ").
create table exdoc_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);
alter table exdoc_groups enable row level security;

-- Deleting a group never deletes documents: they fall back to "no group".
alter table exdocs add column group_id uuid references exdoc_groups(id) on delete set null;
