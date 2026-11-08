-- Ex Doc library (spec "Button C"): admin-managed example PDFs. Never auto-deleted.
create table exdocs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  path        text not null unique,   -- object path in the `exdocs` bucket
  name        text not null,          -- original file name, used for downloads
  size        int  not null,
  uploaded_by text references profiles(line_user_id),
  created_at  timestamptz not null default now()
);
alter table exdocs enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exdocs', 'exdocs', false, 20971520, array['application/pdf']);
