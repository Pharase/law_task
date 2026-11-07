# law_task

A LINE LIFF app for the team: LINE login, admin/member roles, invite codes, and uploads that delete themselves after 1 year. Feature pages (tasks, news, documents, performance, finance) will be added as separate `.html` files, each with an admin version in `admin/`.

## How it fits together

```
LINE app / browser ── index.html, admin/*.html (GitHub Pages)
        │  js/app.js sends the LINE ID token with every call
        ▼
Supabase Edge Function `api` ── checks the token with LINE, checks the role
        ▼
Postgres (profiles, invites, files)  +  Storage bucket `uploads` (private)
```

Browsers never talk to the database directly. Every table has RLS on with no policies, so only the `api` function (service role) can read or write. The pages are public, so the real access control is the role check in `api`, not the `admin/` folder.

## Roles and onboarding

| role | can |
|---|---|
| `pending` | nothing; sees the invite-code screen |
| `member` | use the member pages, upload, see their own files |
| `admin` | everything a member can, plus the `admin/` pages |
| `revoked` | nothing |

1. An admin opens `admin/members.html`, enters a staff name and role, and gets an 8-character code (no `0 O 1 I L`).
2. The code works **once** and expires after **15 minutes**.
3. The new person opens the LIFF link, logs in, and enters the code. They're approved immediately.
4. After **5 wrong codes**, the LINE account is locked. An admin unlocks it (or approves it directly) on `admin/members.html`.

## Uploads

- Pictures (JPG, PNG, WEBP) and PDFs, 10 MB max. HEIC is rejected because only Apple devices can display it. Safari and LINE on iPhone convert HEIC to JPEG before upload anyway.
- Before upload, the browser shrinks pictures to at most 1600 px on the long side and re-encodes them as JPEG, aiming for 50% of the original size or less.
- A daily job (03:00 UTC, `pg_cron`) deletes files older than **365 days** (`RETENTION_DAYS` in `supabase/functions/api/index.ts`). Only use uploads for working copies, not legal documents you must keep.

## Deploy (once)

Needs Node.js. Run from the repo root:

```sh
npx supabase login
npx supabase link --project-ref edymfgeecbsmepdveqkj
npx supabase db push                                   # tables, bucket, daily cleanup job
npx supabase secrets set LINE_CHANNEL_ID=2012450429    # the number before "-" in the LIFF ID
npx supabase functions deploy api                      # verify_jwt=false comes from supabase/config.toml
```

### Automatic deploys (GitHub Actions)

After the first manual deploy, every push to `main` that changes `supabase/` runs [.github/workflows/supabase-deploy.yml](.github/workflows/supabase-deploy.yml). It runs the tests, applies new migrations and deploys `api`. Set these two repo secrets once:

```sh
gh secret set SUPABASE_ACCESS_TOKEN   # create at https://supabase.com/dashboard/account/tokens
gh secret set SUPABASE_DB_PASSWORD    # your database password
```

You can also run it by hand: **GitHub → Actions → Deploy Supabase → Run workflow**.

**Make yourself the first admin.** Open the LIFF app and log in once. You'll land on the invite-code screen. Then run this in the Supabase **SQL Editor**:

```sql
update profiles set role = 'admin' where display_name = '<your LINE name>';
```

After that, add everyone else with invite codes.

## LINE setup

LINE Developers Console → your LINE Login channel → **LIFF**:
- **Endpoint URL**: `https://pharase.github.io/law_task/`
- **Scopes**: `openid`, `profile`

LIFF link: https://liff.line.me/2012450429-k3WOCwtO

## Adding a feature page

```html
<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script src="js/app.js"></script>      <!-- ../js/app.js inside admin/ -->
<link rel="stylesheet" href="css/app.css">
<script>
  start("member").then((me) => { /* page code; call api("action", {...}) */ });   // "admin" in admin/
</script>
```

Add the page's actions to `supabase/functions/api/index.ts`. Put admin-only ones after the `isAdmin` check.

## Tests

```sh
node --test supabase/functions/api/codes.test.ts
```

### Manual check: the invite gate (run after every change to `redeem`)

Use a second LINE account that isn't approved yet.

| # | Do | Expect |
|---|---|---|
| 1 | Admin creates a code; enter it within 15 min | Approved; menu shows |
| 2 | Enter the same code again from another pending account | "wrong or expired code" |
| 3 | Create a code, wait 16 min, enter it | "wrong or expired code" |
| 4 | Enter 5 random codes | 5th shows "Account locked"; admin page shows LOCKED |
| 5 | While locked, enter a fresh valid code | Still locked until an admin clicks Unlock |

## Troubleshooting

- **400 Bad Request on login**: the page URL doesn't match the LIFF Endpoint URL.
- **"Login check failed (invalid or expired LINE ID token)"**: `LINE_CHANNEL_ID` is wrong or not set (`npx supabase secrets list`).
- **Supabase free tier** pauses a project after 7 days with no activity. While it's paused, the app and the cleanup job stop. Restore it from the dashboard.
