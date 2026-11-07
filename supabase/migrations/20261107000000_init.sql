-- Users, invite codes and uploaded files. RLS is on with no policies:
-- browsers never touch these tables; only the `api` Edge Function (service role) does.

create table profiles (
  line_user_id   text primary key,
  display_name   text,
  picture_url    text,
  staff_name     text,
  role           text not null default 'pending' check (role in ('pending', 'member', 'admin', 'revoked')),
  failed_codes   int  not null default 0,
  locked         boolean not null default false,  -- true after 5 wrong invite codes; admin unlocks
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create table invites (
  code        text primary key,
  staff_name  text not null,
  role        text not null check (role in ('member', 'admin')),
  created_by  text not null references profiles(line_user_id),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_by     text references profiles(line_user_id),
  used_at     timestamptz
);

create table files (
  id          uuid primary key default gen_random_uuid(),
  owner       text not null references profiles(line_user_id),
  path        text not null unique,          -- object path inside the `uploads` bucket
  name        text not null,
  mime        text not null,
  size        int  not null,
  created_at  timestamptz not null default now()
);
create index files_created_at on files (created_at);

alter table profiles enable row level security;
alter table invites  enable row level security;
alter table files    enable row level security;

-- Private bucket; 10 MB cap; pictures and PDFs only (no HEIC: only Apple devices can display it).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
