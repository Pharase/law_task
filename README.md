# law_task

A LINE LIFF app for the legal team. It replaces the old Google Sheets task system.

- **Work (Button A / home page):** admins assign tasks; members send work in with attachments; admins approve or send it back (กดผิด / มีปรับแก้). Monthly and quarterly performance is calculated from this.
- **Ex Doc. (Button C):** a library of example legal PDFs. Admins upload; members preview or download.
- **Daily LINE summary:** one message per person per weekday at 09:00, sent only when there's news.
- **Uploads:** kept at least 1 year, and deleted only after an admin has downloaded a backup.

Design: [docs/superpowers/specs/2026-11-08-task-tracking-exdoc-design.md](docs/superpowers/specs/2026-11-08-task-tracking-exdoc-design.md)

## How it fits together

```
LINE app / browser ── index.html, Button */, admin/*.html (GitHub Pages)
        │  js/app.js sends the LINE ID token with every call
        ▼
Supabase Edge Function `api` ── checks the token with LINE, checks the role
        ├──▶ Google Sheet via Apps Script (gscript/): Tasks, Sends, Buildings, Members  ← source of truth for work
        ▼
Postgres (profiles, invites, files, exdocs, notify_log)
Storage: `uploads` (task attachments, private) · `exdocs` (PDFs, private, never auto-deleted)
pg_cron: daily cleanup (03:00 UTC) · daily LINE summary (09:05 Bangkok, Mon–Fri)
```

Browsers never talk to the database directly. Every table has RLS on with no policies, so only the `api` function (service role) can read or write. The pages are public, so the real access control is the role check in `api`, not the `admin/` folder.

**Code map** (`supabase/functions/api/`):

| File | Job |
|---|---|
| `index.ts` | Login check and routing |
| `tasks-api.ts`, `exdocs-api.ts`, `backup-api.ts`, `notify-api.ts` | Handlers for each feature |
| `sheet.ts` | Calls the Apps Script row store (secret, 10 s timeout, compare-and-set batches) |
| `sheetRows.ts` | **Checks every sheet row** (hand edits): bad rows are hidden and listed on `admin/tasks.html` |
| `scoring.ts` | **All performance rules (provisional; change them only here)** |
| `review.ts`, `digest.ts`, `retention.ts`, `dates.ts`, `codes.ts` | Pure rules, unit-tested |

## Roles and onboarding

| role | can |
|---|---|
| `pending` | nothing; sees the invite-code screen |
| `member` | own tasks, send work, own performance, Ex Doc |
| `admin` | the "boss": assign/review all tasks, all performance, Ex Doc upload, members, backups. **Never owns tasks.** |
| `revoked` | nothing |

Staff from the old sheet are imported already approved (see Go-live). Everyone else joins with an invite code:

1. An admin opens `admin/members.html`, enters a staff name and role, and gets an 8-character code (no `0 O 1 I L`).
2. The code works **once** and expires after **15 minutes**.
3. The new person opens the LIFF link, logs in, and enters the code. They're approved immediately.
4. After **5 wrong codes**, the LINE account is locked. An admin unlocks it (or approves it directly) on `admin/members.html`.

## Work: task flow

```
admin assigns ─▶ On Process ─▶ member sends (optional files) ─▶ Waiting for review
                     ▲                                             │
                     ├── กดผิด: send ignored, same due date ◀──────┤
                     ├── มีปรับแก้: fix note + new due date ◀───────┤
                     └─────────────────────────── Approved ◀───────┘
```

- **Admin page** `admin/tasks.html`: assign (pick several members to create one task each), the review queue, all tasks with filters, edit/cancel before the first send, and performance by month or quarter.
- **Scoring (provisional):** 10 points if sent on time, minus 1 per 3 days late, never below 0. The task score averages on-time and accuracy (each fix round scored against its own due date). Shown on a 1–5 scale across members. See `scoring.ts` and its tests.

## Uploads and backups

- Pictures (JPG, PNG, WEBP) and PDFs, 10 MB max. Pictures are shrunk in the browser (≤1600 px, JPEG, about half the size). HEIC is rejected.
- Files over **365 days** old are **due**. Admin pages then show a banner with **Download backup**, which builds a ZIP in the browser (parts of ≤200 MB) and records the backup. The daily cleanup deletes **only due files that have a recorded backup**, and keeps the row so task history shows "deleted after backup".

## Go-live checklist (owner, once)

0. **Google Sheet** (see "Google Sheet setup" below). Until it's done, the Work pages show "Google Sheet not reachable".
1. **Import staff:** paste `old-system/import.sql` (generated locally, never committed) into the Supabase **SQL Editor** and run it. It adds 29 staff as members. **Buildings:** paste the lines of `old-system/buildings.txt` into the sheet's **Buildings** tab from cell A2.
2. **Make yourself admin:** log in to the LIFF app once, then run `update profiles set role = 'admin' where display_name = '<your LINE name>';` in the SQL Editor.
3. **LINE bot token:** in LINE Developers Console → the Messaging API channel → **re-issue** the channel access token (the old one is hard-coded in the old script). Then set it in Supabase: `npx supabase secrets set LINE_MESSAGING_TOKEN=<token>`, or use **Edge Functions → Secrets** in the dashboard. Until it's set, the daily summary is skipped.
4. **Rich menu links** (LINE Official Account Manager): see the table below.
5. **LIFF scopes:** `openid` and `profile` (otherwise names and pictures stay empty).
6. Members must have the bot as a LINE friend to receive summaries (old users already do).

## Google Sheet setup (owner, once)

Tasks, sends and buildings live in a Google Sheet. Admins may fix things by hand there; the app re-reads the sheet on every page load.

1. **Turn on the Apps Script API** for your Google account: https://script.google.com/home/usersettings (needed for `clasp push`).
2. **Push the script:** `cd gscript && npx @google/clasp push --force`.
3. **Connect the spreadsheet.** If the script was created from the sheet (Extensions → Apps Script), skip this. Otherwise, in the Apps Script editor → **Project Settings → Script properties**, add `SHEET_ID` = the long id in the sheet's URL (`/d/<id>/edit`).
4. **Secret:** in the same Script properties, add `API_SECRET` = a long random string (for example the output of `openssl rand -hex 32`). Don't paste it in chat or commit it.
5. **Run `setup`** once from the editor (choose `setup` in the function list, then Run). Google asks for permission the first time. This creates the tabs, headers, dropdowns and warning-only protection. It's safe to run again.
6. **Run `selfTest`.** The log should end with "selfTest passed".
7. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**. Copy the `/exec` URL.
8. **Give the URL and secret to Supabase:** `npx supabase secrets set GSHEET_URL=<exec url> GSHEET_SECRET=<the same string>`.

**Invoices and monthly reports (added later; do once):**
1. In the Apps Script editor, run **`setup`** again. It adds the **Invoices** tab and a **type** column (บ้านจัดสรร / อาคารชุด dropdown) to **Buildings**; existing data stays. Set each building's type there once.
2. Put the monthly reports in one Google Drive folder (PDF, Google Docs, Sheets or Slides; Docs/Sheets/Slides are exported to PDF). In **Project Settings → Script properties** add `REPORT_FOLDER_ID` = the folder id from its URL (`/folders/<id>`).
3. Run **`checkReports`** once: Google asks for Drive permission, and the log lists the files the app will show.
4. **Deploy → Manage deployments → edit → New version** (the `/exec` URL stays the same).

**ข้อมูลการมอบหมาย (which หัวหน้างาน looks after which building):** run **`setup`** again once to add the **owner** column to **Buildings**. Admins then drag buildings between people on Home → ข้อมูลการมอบหมาย (on phones: tap a building, then tap the person), or pick names in the sheet. The assign form shows only the chosen person’s buildings, and the server refuses a building outside their responsibility. People with no buildings yet are not restricted.

After changing the script later: `clasp push`, then **Deploy → Manage deployments → edit → New version** (the `/exec` URL stays the same).

**Hand-edit rules.** Edit freely: `building`, `title`, `details`, `tags`, `owner_name` (= reassign to that person), `due_on`. Leave alone: `id`, `owner_id`, `state`, `current_due_on`, `fix_round` and the Sends and Members tabs (Google shows a warning). Don't copy whole rows: a duplicate id is flagged. A bad row (typo'd date, unknown building or name) is hidden from the app and listed under "Sheet rows to fix" on `admin/tasks.html`.

## Deploy

Every push to `main` that changes `supabase/` runs [.github/workflows/supabase-deploy.yml](.github/workflows/supabase-deploy.yml): tests → migrations → `LINE_CHANNEL_ID` → deploy `api`. You can also run it by hand from any branch: `gh workflow run supabase-deploy.yml --ref <branch>`. It needs one repo secret, and no database password:

```sh
gh secret set SUPABASE_ACCESS_TOKEN   # paste a token from https://supabase.com/dashboard/account/tokens at the prompt
```

## LINE setup

LINE Developers Console → LINE Login channel → **LIFF**: Endpoint URL `https://pharase.github.io/law_task/`, scopes `openid`, `profile`.
LIFF link: https://liff.line.me/2012450429-k3WOCwtO

## Rich menu buttons

Rich menu layout: a 3×2 grid where A+B is one wide tile. The same buttons form the top navbar on every page. **Home (A+B)** is a dashboard for everyone: a donut of the tasks assigned this month by status (รอดำเนินการ, รอแก้ไข, รอตรวจสอบ, เสร็จสิ้น ส่งตรงเวลา / ส่งล่าช้า) plus งานคงค้างอื่นๆ (unfinished tasks from earlier months); tap a status to list its tasks. Members see their own tasks, admins the whole team, plus **มอบหมายงาน** (assign form), **ติดตามงาน** (`admin/tasks.html`: review queue and all tasks) and **สมาชิก**. **Reports (D)** holds the performance scores. Admins tapping Ex Doc. (C) get `admin/exdoc.html`.

| Button | Feature | Rich menu link |
|---|---|---|
| A (A+B) | Work · งานรอดำเนินการ (home page) | `https://liff.line.me/2012450429-k3WOCwtO` or `…/Button%20A/` |
| C | Ex Doc. · ตัวอย่างเอกสารฝ่ายกฎหมาย | `https://liff.line.me/2012450429-k3WOCwtO/Button%20C/` |
| D | Reports · รายงานประจำเดือน (from Google Drive, view/download in the app) and performance scores | `https://liff.line.me/2012450429-k3WOCwtO/Button%20D/` |
| E | Property Right · อายัดและแจ้งบุริมสิทธิ (coming soon) | `https://liff.line.me/2012450429-k3WOCwtO/Button%20E/` |
| F | Invoice · ใบแจ้งหนี้ค้างเบิก: everyone sees all invoices (filter บ้านจัดสรร / อาคารชุด); admins add and edit | `https://liff.line.me/2012450429-k3WOCwtO/Button%20F/` |

## Adding a feature

- **Page:** load the LIFF SDK, `js/app.js` (`../js/app.js` from a subfolder) and `css/app.css`, then `start("member")` (or `"admin"`) and call `api("action", {...})`. Build DOM with `textContent` (`el()` in `js/work.js`), never `innerHTML`.
- **Backend:** add a `<feature>-api.ts` exporting `member…Actions` / `admin…Actions(action, body, me)` that return `undefined` for actions they don't own. Add them to `MEMBER_HANDLERS` / `ADMIN_HANDLERS` in `index.ts`. Put rules in a pure module with a test.

## Tests

```sh
node --test "supabase/functions/api/*.test.ts" "gscript/*.test.cjs"
```

### Manual check: the invite gate (after any change to `redeem`)

Use a second LINE account that isn't approved yet.

| # | Do | Expect |
|---|---|---|
| 1 | Admin creates a code; enter it within 15 min | Approved; menu shows |
| 2 | Enter the same code again from another pending account | "wrong or expired code" |
| 3 | Create a code, wait 16 min, enter it | "wrong or expired code" |
| 4 | Enter 5 random codes | 5th shows "Account locked"; admin page shows LOCKED |
| 5 | While locked, enter a fresh valid code | Still locked until an admin clicks Unlock |

### Manual check: tasks, Ex Doc, backups (after deploy; one admin + one member account)

| # | Do | Expect |
|---|---|---|
| 1 | Admin assigns a task to the member | Appears in the member's Active list |
| 2 | Member attaches a file and taps Send | Moves to Waiting; admin sees it in the review queue with the file |
| 3 | Admin: Not approved → กดผิด | Back to Active, same due date; that send doesn't count in performance |
| 4 | Send again; admin: Not approved → มีปรับแก้ with an empty note | Blocked |
| 5 | มีปรับแก้ with a note and a new date | Member sees the note and the new due date, plus "รอบแก้ 1" |
| 6 | Send again; two admins tap Approved at the same time | One succeeds; the other sees "already reviewed by another admin" |
| 7 | Member calls `sendTask` with another member's file id | That file is not attached |
| 8 | Member opens `admin/tasks.html` | Redirected home; no data |
| 9 | Admin uploads a PDF on `admin/exdoc.html` | Member sees it on Button C; Preview opens it, Download saves it with its original name |
| 10 | After the token is set, on a weekday after 09:00 call `{"action":"digest"}` | Each person with news gets one LINE message; a second call returns "not now" |
| 11 | Change a task's `title` by hand in the sheet, reload the app | The new title shows |
| 12 | Type `tomorrow` into a task's `due_on` cell | The task disappears from the member's list; `admin/tasks.html` lists "Sheet "Tasks" row N: due_on is not a YYYY-MM-DD date" |
| 13 | Pick another member in a task's `owner_name` dropdown | The task moves to that member; `owner_id` updates itself |

## Troubleshooting

- **400 Bad Request on login**: the page URL doesn't match the LIFF Endpoint URL.
- **"Login check failed (invalid or expired LINE ID token)"**: `LINE_CHANNEL_ID` is wrong or not set (`npx supabase secrets list`).
- **No daily LINE summary**: `LINE_MESSAGING_TOKEN` not set, the quota is used up (admin pages show a banner), or the member hasn't added the bot as a friend. Check the `notify_log` table.
- **"Google Sheet not reachable, try again"**: `GSHEET_URL` / `GSHEET_SECRET` not set or different from the script's `API_SECRET`, the web app wasn't deployed for "Anyone", or Google took over 10 s. The function logs (Supabase → Edge Functions → api → Logs) show the reason after `sheet`.
- **LINE "เกิดข้อผิดพลาด" after logging in (new users only)**: the LINE Login channel is still **Developing**; publish it in LINE Developers Console.
- **Supabase free tier** pauses a project after 7 days with no activity. While it's paused, the app, the cleanup and the LINE summaries stop. Restore it from the dashboard.
