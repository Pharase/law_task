# Task tracking (Button A) and Ex Doc library (Button C): design

Status: **approved** 2026-11-08 (scoring formulas provisional)

## Intent

law_task replaces an old Google Sheets + Apps Script system (`old-system/DB_prohouse.xlsx`, `old-system/script/`) that a legal team uses to assign work about juristic-person buildings (นิติบุคคล), remind people through LINE, review the work, and score each person's timeliness. The old system breaks easily: its formulas stop at row 1004, fix-round reminders never fire, and one blank cell stops all notifications. It also keeps the LINE bot token in plain code.

This phase delivers the two features the team uses every day:

- **Button A, Work:** admins assign tasks, members send work in, admins approve or send it back, and everyone sees their own tasks. Monthly and quarterly performance is computed from this.
- **Button C, Ex Doc.:** admins keep a library of example legal PDFs, and members preview or download them.

Everything must work on a phone (inside LINE) and on a computer browser.

## Already built (foundation, do not redo)

- Static pages on GitHub Pages; LIFF login (`js/app.js`: `start()`, `api()`, `uploadFile()`, `shrinkImage()`).
- One Supabase Edge Function `api` (`supabase/functions/api/index.ts`). It verifies the LINE ID token with LINE on every call, then acts with the service role. All tables have RLS on with no policies, so browsers never touch the database directly. New features add actions to this function: member actions before the `isAdmin` check, admin actions after it.
- Roles: `pending`, `member`, `admin`, `revoked`. Onboarding uses invite codes (8 characters, single use, 15-minute expiry, lock after 5 wrong tries). The admin page is `admin/members.html`.
- `files` table plus private `uploads` bucket (pictures and PDFs, 10 MB, pictures shrunk in the browser). A daily `pg_cron` job calls the `cleanup` action, which today deletes uploads older than 365 days. **This phase changes that** (see Retention).
- CI: a push to `main` that touches `supabase/` runs the tests, `db push --remote --yes` and `functions deploy api --yes`.
- Rich-menu pages `Button A`, `Button C`, `Button D`, `Button E`, `Button F` (placeholders).

## Goals

1. Admins create tasks and assign them to members.
2. Members see their tasks, attach documents and send work in.
3. Admins review: Approved, or Not approved with a reason. The reason **กดผิด** returns the task to the member with no scoring effect. The reason **มีปรับแก้** comes with fix notes and opens a scored fix round.
4. LINE notifications for each step, sent through the existing bot.
5. Per-member performance for each month and each quarter, using the old scoring formulas.
6. An Ex Doc library: admin upload and delete, member preview and download.
7. Retention with a required backup: attachments over 1 year old are deleted only after an admin has downloaded them in a backup.
8. Staff from the old sheet start out already linked to their LINE accounts, with no invite code needed.

## Non-goals (this phase)

- Buttons D (Reports), E (Property Right) and F (Invoice). They stay placeholders. Monthly reports beyond the performance view belong to D later.
- Team-level scores and the org chart. The old Team_summary scored teams; this phase scores **members**. Team scoring can be built later on the same data.
- Importing old **tasks** or their history. Only staff and buildings are imported (see Migration).
- Google Sheets sync (`gscript/`). That comes later.
- Members creating tasks, or tasks assigned between members.

## Anti-goals (would be a failure even if it "works")

- Any file deleted without a recorded admin backup.
- Scores that differ from the old formulas for the same dates.
- A member seeing another member's tasks, or a non-admin reaching admin actions. The pages are public, so the check must happen in `api`.
- The LINE bot token anywhere in the repo, which is public.

## Users and roles

- **Admin:** the "boss" role. Assigns, reviews, sees everyone's tasks and performance, and manages Ex Docs and backups. There can be several admins, and any admin can review any task. **Admins never own tasks** (the owner picker lists only members, and `api` rejects an admin as owner), and admins are **not** in performance results.
- **Member:** sees only their own tasks and their own performance, sends work in, and reads Ex Docs.

## Button A: Work

### Entry point

Button A opens the **home page** (`index.html`). The `Button A` folder **stays**: its page forwards to the home page, so the rich-menu link for A can be either the plain LIFF URL `https://liff.line.me/2012450429-k3WOCwtO` or `…/Button%20A/`. The home page keeps its current login, invite-code and locked states. For an approved user, the "Menu" card becomes the Work dashboard, and links to the other buttons move to a compact menu.

### Task fields

| Field | Notes |
|---|---|
| building | Chosen from the buildings list (imported from the old `project_list`; admins can add more). |
| title | Required, max 200 characters. |
| details | Optional long text. |
| tags | One or more of: ความถูกต้อง, เสนออนุมัติ/ลงนามกรรมการ, การประสานงาน, ติดตามความคืบหน้าคดี. Fixed list. |
| owner | One member. If the admin picks several members, the system creates **one task per member** with the same content, as the old `splitResponsible` did (my call). |
| due date | A date, in the Asia/Bangkok time zone. |
| assigned by / at | Set automatically. |

### States

```
on_process ──send──▶ submitted ──Approved──────────────▶ approved (final)
     ▲                   │
     │                   ├──Not approved: กดผิด ─────────▶ on_process  (send is voided; no scoring effect; same due date)
     │                   │
     └───────────────────┴──Not approved: มีปรับแก้ ───────▶ on_process  (new fix round, admin sets new due date + fix notes)
```

- **กดผิด:** the send is recorded but marked void. It doesn't count toward scores, and the task keeps its current due date. The task is scored normally when it's eventually approved (my reading of "not include that task for calculating").
- **มีปรับแก้:** the admin must write fix notes in a long text box and set a new due date for the fix. Each one starts a fix round (round 1, 2, …). The old sheet allowed 5 rounds. This design has no hard limit, but after 5 rounds the reminders and the dashboard say "over 5 fix rounds", as the old script did.
- Every send, review, reason, note and due date is kept as history, so each task has a full timeline.

### Member view (home page, approved user)

- **Active:** tasks that are `on_process`, sorted by due date. Overdue tasks are highlighted. Tasks sent back show the reason and fix notes.
- **Waiting for review:** tasks that are `submitted`.
- **Done:** tasks that are `approved`, newest first, with a short history.
- **Each task:** details, building, tags, current due date, timeline, and attachments.
- **Send work:** optionally attach files (existing upload flow, picture or PDF, several files allowed), then tap **Send**. Attachments are tied to the task and to that send.
- **My performance:** this month and this quarter (see Performance).

### Admin view (`admin/tasks.html`)

- **Create task** form (fields above).
- **Waiting for review** queue: every `submitted` task, oldest first, with its attachments.
- **Review:** **Approved**, or **Not approved** → a reason dropdown (`กดผิด`, `มีปรับแก้`). When `มีปรับแก้` is chosen, a required long text box (what to fix) and a required new due date appear.
- **All tasks:** filter by member, building, state, and overdue.
- **Edit or cancel a task:** fix typos or the due date before the first send. Cancelled tasks are excluded from scoring (my call).
- **Performance:** a table of all members for a chosen month or quarter.

### Notifications (LINE Messaging API, existing bot, **free plan**)

Same provider is confirmed, so the LIFF `line_user_id` equals the bot's userId. The bot is on LINE's **free plan**, which has a small monthly push limit counted per recipient, and the team is about 10 people. So notifications are **bundled into one daily summary per person**, not sent per event:

| When | To | Content (sent only if non-empty) |
|---|---|---|
| Daily 09:00 Bangkok | each member | One message: new tasks assigned since the last summary; tasks due today (original or fix due date, which fixes the old bug); overdue tasks; tasks sent back with reason and notes; tasks approved. A button opens the home page. |
| Daily 09:00 Bangkok | each admin | One message: N tasks waiting for review (oldest first, short list), plus "N files waiting for backup" when N > 0. A button opens `admin/tasks.html`. |

- **Worst case** with about 10 people on 22 working days: under 300 messages a month, and fewer in practice because empty summaries aren't sent. Weekends are skipped (my call).
- **Quota guard:** before sending each day's summaries, check the remaining monthly quota with LINE's quota endpoints (`/v2/bot/message/quota` and `/v2/bot/message/quota/consumption`). If it's too low, send to **admins only**, then nobody. Log the skip, and show a "LINE quota reached, check the app" banner on admin pages. The in-app views always show everything, so a skipped summary loses nothing.
- **In the app, without LINE:** the review queue, a member's task lists and the backup banner always show the current state. LINE is only a nudge.

- The bot token is a Supabase secret (`LINE_MESSAGING_TOKEN`), never in the repo. The old token is hard-coded in the old script, so it should be **re-issued** in the LINE console when switching over.
- A failed LINE push must not undo the action. Log it and carry on.
- Card buttons open LIFF URLs. Postback buttons, like the old "Done ✅", are not used.

## Performance

**Provisional:** the owner will adjust the formulas later. Build them as written below, but keep **all** scoring rules in one pure module (one file plus its tests), so a later change touches only that file. Store raw dates and history, never precomputed scores.

Computed per member, for a calendar **month** and a calendar **quarter** (Q1 = Jan–Mar, …, Asia/Bangkok dates). It works on tasks whose **original due date** falls in the period, the same filter the old sheet used, and only on **approved** tasks.

The day score for "sent on day S, due on day D" (whole days):

```
late = S − D
score = 10                 if late ≤ 0
      = max(0, 10 − late/3) otherwise
```

For each approved task:

- **On-time score:** the day score of the **final approved** send against the **latest** due date (the original due date or the last fix due date, whichever is later). This matches the old `J` column.
- **Accuracy score:** the average of the day scores over the first send against the original due date and each **มีปรับแก้** fix send against its fix due date. This matches the old `K` column. **กดผิด** sends are ignored completely.
- **Task score:** the average of on-time and accuracy (the old `L` column).

For each member and period:

- **Overall:** the average task score ÷ 10, a value from 0 to 1.
- **Per tag:** the same average, but only over tasks carrying that tag.
- **1–5 scale:** `1 + 4 × (x − min) / (max − min)`, using the min and max **over all members in the same period**, as the old sheet did. If every member has the same score, show 5.

Show both the raw and the 1–5 values. Members see only their own row. Admins see everyone.

**Exact rules, taken from the old sheet's formulas** (`filter_task` J/K/L, `Team_summary` O/P):

- **No rounding at any step.** `late/3` is a fraction (for example, 4 days late gives 10 − 1.333… = 8.667). Averages are not rounded before scaling. Round only for display, to 2 decimal places.
- **Dates:** whole calendar days in Asia/Bangkok. The send time of day is ignored.
- **Accuracy with no fix rounds** has a single pair, so it equals the on-time score.
- **Only rounds that actually happened count.** The old `Sheet7` averaged all 4 round slots even when they were empty, and an empty slot scored 10. That inflated scores and is deliberately **not** copied.
- **Voided sends:** a **กดผิด** send is ignored completely. The next send that isn't void is treated as the send for that round.
- **1–5 scale population:** only members with at least one approved task in the period, as in the old sheet, where teams with no tasks showed "-" and were left out of min and max. With one such member, or when all are equal, show 5 (the old sheet showed 5 in that case for the coordination score and "N/A" elsewhere; 5 everywhere is my call).

**Worked examples** (for the unit tests; D = due date, S = send date, in days):

| Case | Sends | On-time | Accuracy | Task |
|---|---|---|---|---|
| 1. Early | D=10, S=8, approved | 10 | 10 | 10 |
| 2. 4 days late | D=10, S=14, approved | 8.667 | 8.667 | 8.667 |
| 3. 40 days late | D=10, S=50, approved | 0 | 0 | 0 |
| 4. One fix round | D=10, S=10 → มีปรับแก้, fix D=15, S=18, approved | latest due 15, final send 18 → 9 | avg(10, 9) = 9.5 | 9.25 |
| 5. กดผิด then on time | D=10, S=9 → กดผิด (void), S=12, approved | 12 vs 10 → 9.333 | first non-void 12 vs 10 → 9.333 | 9.333 |

Member overall = average task score ÷ 10. Example: tasks 10 and 8.667 give 0.933. Scaled with min 0.5 and max 1.0: `1 + 4 × (0.933 − 0.5) / 0.5` = 4.47.

The scoring is a pure function (TypeScript, no database access), unit-tested with the cases above.

## Button C: Ex Doc.

- **Member page** (`Button C/index.html`): every Ex Doc PDF, sorted **A–Z by title**, with a search box that filters by title (my call). Each row shows the title, file size and upload date, plus **Preview** (opens in a new tab) and **Download** (saves under the original file name). Links come from `api`, which returns signed URLs that expire in 1 hour.
- **Admin page** (`admin/exdoc.html`): upload a PDF (max 20 MB, my call) with a title; rename the title; delete (with a confirm prompt).
- **Storage:** a separate private bucket (`exdocs`) that accepts only `application/pdf`. **Ex Docs are never auto-deleted.**
- **Known limit:** LINE's in-app browser on Android may download instead of previewing. That's acceptable.

## Retention: backup before delete

This replaces today's "delete after 365 days".

1. It applies to task attachments and all `uploads` files. It never applies to Ex Docs.
2. A file becomes **due** 365 days after upload.
3. Admin pages show a banner when due files exist: "N files waiting for backup" with a **Download backup** button. Admins also get the monthly LINE reminder (see Notifications).
4. **Download backup** builds a ZIP **in the admin's browser** from short-lived signed URLs. After the download is triggered, the page tells `api` which file IDs were included, and `api` records `backed_up_at` and `backed_up_by`. For large sets, the ZIP may be split into several parts (builder's call on size).
5. The daily cleanup deletes only files that are **due and have `backed_up_at` set**. A file with no recorded backup is never deleted.
6. Deleting a file keeps its database row (path, name, owner, task, backup info) and marks it deleted, so task timelines still show "file deleted after backup on DATE".

## Migration from the old system

- **Staff:** create `profiles` rows from the old sheet's `UserList` and `UID` tabs: LINE userId, display name and responsibility name as `staff_name`, all with role `member`. Because the provider is the same, these people are approved on first login without an invite code. Admins are then promoted on `admin/members.html`.
- **Buildings:** import the old `project_list` (about 80 names) into the buildings list. Building names are the team's **clients**, so they are treated as confidential: **not** put in a migration in the public repo.
- **How:** a local script reads `old-system/DB_prohouse.xlsx` and writes `old-system/import.sql` (git-ignored) containing upserts for staff and buildings. The project owner pastes it once into the Supabase SQL Editor, after the new tables are deployed and before go-live. The migration only creates empty tables.
- **Old tasks:** not imported (see Non-goals).

## Constraints

- **Hosting:** static pages on GitHub Pages and a public repo, so no secrets or personal data in git.
- **Supabase free tier:** Edge Function time and memory limits, which is why backup ZIPs are built in the browser. The project pauses after 7 days without activity; while paused, notifications and cleanup stop.
- **Thai text:** throughout (UTF-8). Dates display in Thai-friendly format (builder's call), stored as dates.
- **Plain HTML/JS:** no framework or build step, matching the existing pages. A small library from a CDN is fine for the ZIP.
- **Access control:** every new action does its role and ownership check in `api`.

## Manual steps (outside the code)

- Point the rich-menu link for A at `https://liff.line.me/2012450429-k3WOCwtO`, and C, D, E, F at their folders.
- Re-issue the Messaging API channel access token in the LINE console, and set it as the Supabase secret `LINE_MESSAGING_TOKEN`.
- Paste `old-system/import.sql` into the SQL Editor once.
- Members must have the bot as a LINE friend to receive pushes. Old users already do.

## Left to the builder

- How Ex Doc uploads up to 20 MB reach storage (for example, signed upload URLs instead of going through `api`).
- Whether a backup ZIP includes a file list.

- Table and column names, indexes, and how history is stored.
- Exact page layout and styling (reuse `css/app.css`); the phone layout is one column and the desktop layout can use two.
- How reminders are scheduled (`pg_cron` + `api` action, as `cleanup` does today).
- The ZIP library and how a large backup is split into parts.
- Date display format.
- Whether the old Team_summary's per-tag rule ("follow-up score is 1 when the member has tasks but none tagged") is kept. It looks like a quirk; drop it unless it's cheap.
