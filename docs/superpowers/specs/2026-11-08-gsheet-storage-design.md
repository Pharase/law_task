# Google Sheets as the task store: design (change to the approved Button A/C design)

Status: ready for approval · 2026-11-08
Builds on: `2026-11-08-task-tracking-exdoc-design.md` (approved). Everything there stands **except where it says where data lives**.

## Intent

The owner finds Supabase hard to work with and wants the team's working data in a Google Sheet. Admins mostly edit through the web app (all review and reporting happen there) but sometimes fix things **by hand in the sheet**. So the sheet becomes the **source of truth** for task data. Supabase keeps only what a sheet can't do safely:

| Stays in Supabase | Moves to the Google Sheet |
|---|---|
| Logins and roles (`profiles`), invite codes (`invites`) | Tasks |
| Ex Doc PDFs (`exdocs` and its bucket) | Sends and reviews (the history of each task) |
| Task attachment files (`files` and the `uploads` bucket), backups | Buildings |
| LINE summary log (`notify_log`, internal) | A read-only Members list (for hand edits) |

Performance is **not** stored. The web app calculates it from the sheet each time, using the existing tested `scoring.ts`.

The new spreadsheet starts **empty**. Importing the ~500 old tasks from `DB_prohouse.xlsx` is a **later, separate step** (out of scope here; see "Later").

## Goals

1. The web app works exactly as it does today for members and admins, reading and writing the sheet instead of Supabase tables.
2. A hand edit in the sheet shows up in the app on the next page load. No sync job, no copy.
3. A bad hand edit (a typo'd date, an unknown building, a deleted cell) never crashes a page. The row is skipped and reported to admins.
4. The rules stay where they are tested: `review.ts` (กดผิด / มีปรับแก้), `scoring.ts`, `dates.ts`, and the "already reviewed / already sent" race guards.
5. The sheet and its script are unreachable without the secret. Browsers never call the script.

## Non-goals

- Importing the old tasks (later step).
- Moving logins, invites, files or Ex Docs to Google.
- A Performance tab in the sheet (reports are in the web app, per the owner).
- Editing roles or members in the sheet. The Members tab is a read-only mirror.

## Anti-goals

- The Apps Script `/exec` URL working for anyone who has it.
- Two admins approving the same send because the sheet has no transactions.
- A hand edit to an app-owned column (ID, state, history) silently corrupting a task.

## Architecture

```
LINE page ──▶ Supabase `api` (LINE token + role check, unchanged)
                 │  POST {secret, op, …}  (secret only on the server)
                 ▼
          Apps Script web app (gscript/) ──▶ Google Sheet
```

- **Apps Script deployment:** "Execute as: me (the owner)", "Who has access: anyone". Access is controlled by a shared **secret**: Script Property `API_SECRET` must equal Supabase secret `GSHEET_SECRET`, or the script returns `{error:"forbidden"}` and touches nothing. The URL goes in Supabase secret `GSHEET_URL`. Neither value is in the repo.
- **The script is a thin row store.** It knows tabs and columns, not business rules:
  - `read {tabs: string[]}` → each tab's rows as objects keyed by header, plus the sheet row number. One call for several tabs, to keep latency down.
  - `append {tab, rows}` → assigns the next integer `id` under the lock and returns the rows.
  - `update {tab, id, patch, expect?}` → under `LockService`, re-reads the row. If every `expect` field matches, it writes the patch and returns the row; otherwise it returns `{conflict:true}`. This compare-and-set replaces the Postgres "update … where state = 'submitted'" guards.
  - `setup` → creates the tabs, header rows, dropdown validation and protection if they're missing. Idempotent. Run once after deploy and safe to re-run.
  - `replaceMembers {rows}` → overwrites the Members tab.
- **`api` keeps the rules.** `tasks-api.ts` keeps its actions and shapes (`myTasks`, `sendTask`, `reviewTask`, …), so the pages don't change. Its database calls become calls to a small `sheet.ts` client. The guarded flips use `update` with `expect: {state: …}`, and a conflict maps to the same 409s as today.

## Sheet layout

The first row of each tab is the header. Columns marked **app** are owned by the app; columns marked **edit** are fine to hand-edit.

**Tasks**

| column | | notes |
|---|---|---|
| id | app | integer, assigned by the script |
| building | edit | building **name** (dropdown from the Buildings tab) |
| title | edit | |
| details | edit | |
| tags | edit | comma-separated, from the 4 fixed tags (dropdown helper) |
| owner_id | app | LINE userId |
| owner_name | edit | dropdown from Members; changing it by hand **reassigns** the task (see Owner's decisions) |
| state | app | `on_process`, `submitted`, `approved`, `cancelled` |
| due_on | edit | original due date (YYYY-MM-DD) |
| current_due_on | app | blank until the first มีปรับแก้; blank means "use `due_on`" |
| fix_round | app | |
| created_by, created_at | app | |
| member_notified_at | app | daily summary bookkeeping |

**Sends**: id, task_id, sent_on, sent_at, due_on, outcome (`pending`/`approved`/`void`/`fix`), fix_note, next_due_on, reviewed_by, reviewed_at, member_notified_at. All **app**.

**Buildings**: name (edit; admins may add rows by hand).

**Members**: line_user_id, name, role. Read-only mirror, rewritten by the app each time an admin opens an admin page.

**Protection:** the app columns and the Sends and Members tabs get Google's "show a warning when editing" protection, not a hard lock, so the owner can still fix a real mistake.

## Hand edits: how the app copes

- **On every read, rows are validated** with a pure, unit-tested function (`sheetRows.ts`): a missing id or title, a date that isn't YYYY-MM-DD, an unknown state or tag, a building not in Buildings, an owner name not in Members.
  - A bad row is **left out** of member views and of scoring.
  - Admin pages list it as "Sheet row N: reason" so someone can fix it.
- **Blank `current_due_on`** falls back to `due_on`. Blank `fix_round` counts as 0.
- **Deleted rows** simply disappear from the app. A Sends row whose task no longer exists is ignored.

## Owner's decisions on hand edits (2026-11-08)

1. **Changing `owner_name` by hand is a reassignment.** On read, if `owner_name` matches exactly one person in Members, that person's id wins. The app writes the new `owner_id` back to the sheet and clears `member_notified_at`, so the new owner gets the "new task" notice in the next morning summary. If the name matches nobody or more than one person, `owner_id` stays as it is and the row is flagged.
   - Members lists **everyone with a login**: members, admins and revoked people, with their role. So the tasks of a revoked person stay theirs and their past scores still count.
   - A name rename made in the app rewrites `owner_name` on that person's task rows, so it never looks like a reassignment.
   - Admins still can't own tasks: a hand reassignment to an admin is flagged and not applied.
2. **A hand-corrected `due_on` flows through.** `current_due_on` stays **blank** until the first มีปรับแก้, so the member's due date, reminders and scoring follow `due_on` live. Scoring the first send uses the task's **current** `due_on`, not the copy in the Sends row. After a มีปรับแก้, that round's own due date applies. Recorded fix rounds stay as history.

## Builder's calls (from review)

- A send or a review is two writes, so the script has a `batch` op that runs several append/update steps under **one** lock, all or nothing.
- New ids come from a per-tab **counter** (Script Properties), not max+1, so a deleted row's attachments can never land on a new task.
- Date cells are normalized to `YYYY-MM-DD`. Google may return Date objects, or Buddhist-era years when the sheet locale is Thai.
- Pages send the building **name** (the Buildings tab has no ids). `createTask` / `editTask` take `building` instead of `building_id`.
- The script is **bound to the spreadsheet** (`SpreadsheetApp.getActive()`), so no spreadsheet id is needed.

## What changes in Supabase

- A new migration **drops** `tasks`, `task_sends` and `buildings`, which only hold test data. `files.task_id` and `files.send_id` become plain integers (sheet ids) with no foreign key.
- `notify-api.ts` and `backup-api.ts` read tasks and sends through `sheet.ts`. The `member_notified_at` bookkeeping is written back to the sheet.
- New Supabase secrets: `GSHEET_URL`, `GSHEET_SECRET`. CI doesn't set them; the owner does, once.

## Errors and speed

- If the script is down or slow (more than 10 s), `api` returns 503 "Google Sheet not reachable, try again". Nothing is half-written, because each script op is a single locked write.
- Expected latency is about 1–2 s per page action. Pages already show "Loading…".

## Testing

- Pure modules (`sheetRows.ts` validation and row↔object mapping) get `node --test` tests, including hand-edit cases: a bad date, a blank `current_due_on`, an unknown owner name, a deleted task referenced by a send.
- The Apps Script gets a `selfTest()` function, run from the editor, that exercises `append` / `update` with expect / conflict on a scratch tab.
- After deploy, the existing README manual check list is re-run against the sheet, plus "edit a title by hand → app shows it" and "type a bad date by hand → admin sees the row warning".

## Later (not in this change)

- Import old tasks: map `DB_prohouse` Tasks (TaskID, building, title, details, dates, 5 fix rounds) into the Tasks and Sends tabs with a one-off script.
- Optional: an "Open sheet" link for admins.
