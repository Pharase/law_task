# Task tracking (Button A) and Ex Doc library (Button C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admins assign and review tasks; members send work in and track it on the home page. Monthly and quarterly performance, an Ex Doc PDF library, retention with a required backup, and a once-daily LINE summary.

**Architecture:** static pages on GitHub Pages call one Supabase Edge Function, `api` (Deno), which verifies the LINE ID token and then uses the service role. Business rules live in **pure TypeScript modules with no imports** (scoring, review transitions, digest text, retention), tested with `node --test`. Thin handler modules wire them to Postgres and Storage. A push to `main` touching `supabase/` deploys through GitHub Actions.

**Tech Stack:** plain HTML/JS (no build step); Supabase Postgres + Storage + Edge Functions + pg_cron/pg_net; LINE LIFF SDK v2; LINE Messaging API (push, quota); JSZip 3.10.1 from cdnjs; Node 22 `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-11-08-task-tracking-exdoc-design.md` (approved; scoring provisional)

## Global Constraints

- The repo is **public**: no secrets, no personal data, no building names in git. `old-system/` and `*_rows.json` are git-ignored.
- Browsers never touch tables. Every new action goes through `api`, with member actions before the `if (!isAdmin)` line and admin actions after it.
- **Admins never own tasks.** The owner picker lists `role = 'member'` only, `api` rejects other owners, and admins are excluded from performance.
- All dates are **Asia/Bangkok calendar dates** (`YYYY-MM-DD`). Never derive a date from UTC `toISOString().slice(0,10)`.
- Tags, a fixed list: `ความถูกต้อง`, `เสนออนุมัติ/ลงนามกรรมการ`, `การประสานงาน`, `ติดตามความคืบหน้าคดี`.
- Review reasons, exact Thai strings: `กดผิด` (void the send, back to on_process, same due date, no scoring effect) and `มีปรับแก้` (required fix note and required new due date, a scored fix round).
- Ex Doc: PDF only, max 20 MB, private bucket `exdocs`, **never auto-deleted**, list sorted A–Z by title, signed URLs valid 1 hour.
- Retention: `uploads` files are deleted only when `created_at` is older than 365 days **and** `backed_up_at` is set. Rows are kept and marked `deleted_at`.
- LINE: at most **one push per person per Bangkok weekday**, at 09:00, skipped when empty. Token comes from the Supabase secret `LINE_MESSAGING_TOKEN`. A failed push never fails the action.
- Render every user-supplied string with `textContent`, never with `innerHTML`.
- Keep the `Button A` folder. Its page forwards to the home page.
- Run tests with `node --test supabase/functions/api/` (CI runs the same command).

## Review Focus

1. **A member acting on someone else's task** (a guessed `task_id` in `sendTask`): expect 403. The test lives in Task 2 (`canSend`).
2. **Two admins reviewing the same send at once, or a double tap on Approve:** the second gets "already reviewed" and nothing changes twice. The test lives in Task 3 (the conditional update `.eq("state","submitted")`, checked manually).
3. **Sending at 00:30 Bangkok time** must count as that Bangkok day, not the previous UTC day. The test lives in Task 1 (`bangkokDate`).
4. **มีปรับแก้ with an empty note, a missing date, or a new due date before today:** expect a 400 with a clear message. The test lives in Task 2 (`validateReview`).
5. **Attaching file IDs that belong to someone else, or are already attached** to `sendTask`: they're silently ignored, never moved. The test lives in Task 3 (update filtered by `owner` and `task_id is null`, checked manually).

---

## File map

| File | Responsibility |
|---|---|
| `supabase/functions/api/dates.ts` | `bangkokDate`, `daysBetween`, `periodRange` (pure) |
| `supabase/functions/api/scoring.ts` | all scoring rules (pure, provisional) |
| `supabase/functions/api/review.ts` | review validation, state transitions, `canSend` (pure) |
| `supabase/functions/api/digest.ts` | daily summary text builders (pure) |
| `supabase/functions/api/retention.ts` | `isDeletable` (pure) |
| `supabase/functions/api/shared.ts` | `db`, `HttpError`, `must`, `found` (moved out of `index.ts`) |
| `supabase/functions/api/tasks-api.ts` | task, building and performance handlers |
| `supabase/functions/api/exdocs-api.ts` | Ex Doc handlers |
| `supabase/functions/api/backup-api.ts` | backup list/done handlers and the new `cleanup` |
| `supabase/functions/api/notify-api.ts` | `digest` action: quota check, LINE push, log |
| `supabase/functions/api/index.ts` | routing only (dispatch actions to handlers) |
| `supabase/migrations/20261108000000_tasks.sql` | tables, buckets, cron |
| `index.html` + `js/work.js` | member Work dashboard |
| `admin/tasks.html` + `js/admin-tasks.js` | assign, review, all tasks, performance |
| `Button C/index.html`, `admin/exdoc.html` | Ex Doc pages |
| `js/backup.js` | admin backup banner + ZIP download (loaded by admin pages) |
| `Button A/index.html` | forward to home |

---

### Task 1: Dates and scoring (pure)

**Files:**
- Create: `supabase/functions/api/dates.ts`, `supabase/functions/api/scoring.ts`
- Test: `supabase/functions/api/dates.test.ts`, `supabase/functions/api/scoring.test.ts`

**Interfaces:**
- Produces:
  - `bangkokDate(d: Date): string`: the `YYYY-MM-DD` in Asia/Bangkok, using `Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok"})`.
  - `daysBetween(from: string, to: string): number`: whole days from `to − from`.
  - `periodRange(kind: "month"|"quarter", year: number, n: number): { from: string; to: string }`: inclusive bounds. n is 1–12 for a month, 1–4 for a quarter.
  - `type Send = { sentOn: string; dueOn: string; outcome: "pending"|"approved"|"fix"|"void" }`
  - `dayScore(sentOn: string, dueOn: string): number`
  - `taskScore(sends: Send[]): { onTime: number; accuracy: number; task: number } | null`
  - `type ScoredTask = { owner: string; tags: string[]; sends: Send[] }`
  - `memberScores(tasks: ScoredTask[]): Record<string, { overall: number; byTag: Record<string, number>; tasks: number }>`: `overall` and `byTag` are on a 0–1 scale.
  - `scale(values: Record<string, number>): Record<string, number>`: the 1–5 scale.

- [ ] **Step 1: Write the failing tests**

```ts
// dates.test.ts
test("00:30 Bangkok is still that Bangkok day", () =>
  assert.equal(bangkokDate(new Date("2026-03-01T17:30:00Z")), "2026-03-02"));
test("periodRange", () => {
  assert.deepEqual(periodRange("month", 2026, 2), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange("quarter", 2026, 4), { from: "2026-10-01", to: "2026-12-31" });
});
// scoring.test.ts — spec's worked examples (D/S as dates in Jan 2026)
const s = (sentOn, dueOn, outcome) => ({ sentOn, dueOn, outcome });
test("early", () => assert.deepEqual(taskScore([s("2026-01-08","2026-01-10","approved")]), { onTime: 10, accuracy: 10, task: 10 }));
test("4 days late", () => assert.ok(Math.abs(taskScore([s("2026-01-14","2026-01-10","approved")]).task - 8.6667) < 1e-3));
test("40 days late floors at 0", () => assert.equal(taskScore([s("2026-02-19","2026-01-10","approved")]).task, 0));
test("one fix round", () => assert.deepEqual(
  taskScore([s("2026-01-10","2026-01-10","fix"), s("2026-01-18","2026-01-15","approved")]),
  { onTime: 9, accuracy: 9.5, task: 9.25 }));
test("void send ignored", () => assert.ok(Math.abs(
  taskScore([s("2026-01-09","2026-01-10","void"), s("2026-01-12","2026-01-10","approved")]).task - 9.3333) < 1e-3));
test("not approved -> null", () => assert.equal(taskScore([s("2026-01-09","2026-01-10","pending")]), null));
test("scale min-max, single/equal -> 5", () => {
  const r = scale({ a: 0.5, b: 1.0, c: 0.9333 });
  assert.equal(r.a, 1); assert.equal(r.b, 5); assert.ok(Math.abs(r.c - 4.4667) < 1e-3);
  assert.deepEqual(scale({ a: 0.7 }), { a: 5 });
});
test("memberScores averages task scores / 10 and per tag", () => {
  const m = memberScores([
    { owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08","2026-01-10","approved")] },
    { owner: "U1", tags: ["ความถูกต้อง"], sends: [s("2026-01-14","2026-01-10","approved")] }]);
  assert.ok(Math.abs(m.U1.overall - 0.9333) < 1e-3);
  assert.equal(m.U1.byTag["การประสานงาน"], 1); assert.equal(m.U1.tasks, 2);
});
```

- [ ] **Step 2: Run `node --test supabase/functions/api/`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement both modules.**
  - `dayScore`: `late = daysBetween(dueOn, sentOn)`; return `late <= 0 ? 10 : Math.max(0, 10 - late/3)`.
  - `taskScore`: drop `void` sends; return null unless the last send is `approved`.
  - `onTime = dayScore(last.sentOn, max dueOn over the kept sends)`.
  - `accuracy` = the mean `dayScore(sentOn, dueOn)` over the kept sends. Their outcomes are `fix` or `approved`.
  - Add a header comment: `// PROVISIONAL scoring (spec "Performance"): change rules only here`.
- [ ] **Step 4: Run `node --test supabase/functions/api/`.** Expected: all PASS, including the existing `codes.test.ts`.
- [ ] **Step 5: Commit** with `feat: pure date and scoring modules`.

### Task 2: Review rules (pure)

**Files:**
- Create: `supabase/functions/api/review.ts`
- Test: `supabase/functions/api/review.test.ts`

**Interfaces:**
- Consumes: `bangkokDate` from Task 1.
- Produces:
  - `type Decision = "approved" | "กดผิด" | "มีปรับแก้"`
  - `validateReview(input: { decision: string; note?: string; nextDueOn?: string }, today: string): { decision: Decision; note: string | null; nextDueOn: string | null }`. It throws `Error` with a user-facing message.
  - `reviewEffect(decision: Decision, nextDueOn: string | null): { taskState: "approved" | "on_process"; sendOutcome: "approved" | "void" | "fix"; newDueOn: string | null; fixRoundDelta: 0 | 1 }`
  - `canSend(task: { owner: string; state: string }, me: string): boolean`. True only when the owner matches and the state is `on_process`.
  - `TAGS: readonly string[]`: the four tags from Global Constraints.

- [ ] **Step 1: Write the failing tests**

```ts
const today = "2026-03-10";
test("approve", () => assert.deepEqual(reviewEffect("approved", null),
  { taskState: "approved", sendOutcome: "approved", newDueOn: null, fixRoundDelta: 0 }));
test("กดผิด keeps due date", () => assert.deepEqual(reviewEffect("กดผิด", null),
  { taskState: "on_process", sendOutcome: "void", newDueOn: null, fixRoundDelta: 0 }));
test("มีปรับแก้ sets new due + round", () => assert.deepEqual(reviewEffect("มีปรับแก้", "2026-03-15"),
  { taskState: "on_process", sendOutcome: "fix", newDueOn: "2026-03-15", fixRoundDelta: 1 }));
test("มีปรับแก้ needs note", () => assert.throws(() => validateReview({ decision: "มีปรับแก้", nextDueOn: "2026-03-15" }, today), /note/i));
test("มีปรับแก้ needs date", () => assert.throws(() => validateReview({ decision: "มีปรับแก้", note: "fix p.2" }, today), /due/i));
test("มีปรับแก้ date not in past", () => assert.throws(() => validateReview({ decision: "มีปรับแก้", note: "x", nextDueOn: "2026-03-09" }, today), /past/i));
test("unknown decision", () => assert.throws(() => validateReview({ decision: "maybe" }, today)));
test("canSend only own on_process task", () => {
  assert.equal(canSend({ owner: "U1", state: "on_process" }, "U1"), true);
  assert.equal(canSend({ owner: "U2", state: "on_process" }, "U1"), false);
  assert.equal(canSend({ owner: "U1", state: "submitted" }, "U1"), false);
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `review.ts`.** Trim the note. A note over 2000 characters is an error.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: pure review rules`.

### Task 3: Schema and task API

**Files:**
- Create: `supabase/migrations/20261108000000_tasks.sql`, `supabase/functions/api/shared.ts`, `supabase/functions/api/tasks-api.ts`
- Modify: `supabase/functions/api/index.ts`. Move `db`, `bucket`, `HttpError`, `must` and `found` to `shared.ts`, then route the new actions.

**Interfaces:**
- Consumes: Task 1 and Task 2 exports.
- Produces (the request bodies are JSON; `id`s are numbers):
  - **Member actions:**
    - `myTasks` → `Task[]`, each with `sends: Send[]` and `files: {id,name,url}[]` (signed URLs, 1 hour)
    - `sendTask {task_id, file_ids?: string[]}` → `Task`
    - `listBuildings` → `{id,name}[]`
  - **Admin actions:**
    - `listMembers` → `{line_user_id, staff_name, display_name}[]`, members only
    - `addBuilding {name}` → `{id,name}`
    - `createTask {building_id, title, details?, tags: string[], owners: string[], due_on}` → `Task[]`, one per owner
    - `listTasks {owner?, building_id?, state?, overdue?: boolean}` → `Task[]` with sends and files
    - `reviewTask {task_id, decision, note?, next_due_on?}` → `Task`
    - `editTask {task_id, title?, details?, tags?, building_id?, due_on?}` → `Task`, allowed only while no send exists
    - `cancelTask {task_id}` → `Task`
  - `Task = { id, building_id, building, title, details, tags, owner, owner_name, state, due_on, current_due_on, fix_round, created_at, sends, files }`

**Schema** (migration). Every table gets `alter table … enable row level security;` with no policies.
- `buildings(id bigint generated always as identity primary key, name text not null unique)`
- `tasks(id bigint identity pk, building_id bigint not null references buildings, title text not null check (char_length(title) <= 200), details text, tags text[] not null check (tags <@ array['ความถูกต้อง','เสนออนุมัติ/ลงนามกรรมการ','การประสานงาน','ติดตามความคืบหน้าคดี'] and cardinality(tags) > 0), owner text not null references profiles, state text not null default 'on_process' check (state in ('on_process','submitted','approved','cancelled')), due_on date not null, current_due_on date not null, fix_round int not null default 0, created_by text not null references profiles, created_at timestamptz default now(), member_notified_at timestamptz)`
- `task_sends(id bigint identity pk, task_id bigint not null references tasks on delete cascade, sent_on date not null, sent_at timestamptz default now(), due_on date not null, outcome text not null default 'pending' check (outcome in ('pending','approved','void','fix')), fix_note text, next_due_on date, reviewed_by text references profiles, reviewed_at timestamptz, member_notified_at timestamptz)`
- `alter table files add column task_id bigint references tasks, add column send_id bigint references task_sends, add column backed_up_at timestamptz, add column backed_up_by text references profiles, add column deleted_at timestamptz;`
- Indexes: `tasks(owner, state)`, `tasks(state)`, `task_sends(task_id)`, `files(task_id)`.

- [ ] **Step 1: Write the migration** as above.
- [ ] **Step 2: Move the shared helpers** to `shared.ts`, export them, and import them in `index.ts`. Run `node --test supabase/functions/api/`. Expected: PASS, since nothing behaves differently.
- [ ] **Step 3: Implement `tasks-api.ts`**, exporting `memberTaskActions(action, body, me)` and `adminTaskActions(action, body, me)`. Each returns a value, or `undefined` for an action it doesn't handle. `index.ts` calls the member handler before the `isAdmin` check and the admin handler after it.
  - **createTask:**
    - Reject (400) any owner whose profile role isn't `member`.
    - Validate the tags against `TAGS`.
    - Set `current_due_on = due_on`.
  - **sendTask:**
    - Load the task, then `canSend` or 403.
    - Insert `task_sends {sent_on: bangkokDate(new Date()), due_on: task.current_due_on}`.
    - Update the task's `state` to `submitted`.
    - Attach files with `update files set task_id, send_id where id in file_ids and owner = me and task_id is null`.
  - **reviewTask:**
    - `validateReview(body, bangkokDate(new Date()))`, mapping its errors to a 400.
    - Find the latest `pending` send.
    - Update the task with `.eq("state","submitted")` and `.select().maybeSingle()`. If no row comes back, return 409 "already reviewed".
    - Then update the send's `outcome`, `fix_note`, `next_due_on`, `reviewed_by` and `reviewed_at`.
    - Apply `reviewEffect`: when `newDueOn` is set, update `current_due_on`, and add `fixRoundDelta` to `fix_round`.
  - **myTasks / listTasks:**
    - One query each for tasks, their sends and their files (no query per row).
    - Batch the signed URLs with `createSignedUrls`.
    - Skip files whose `deleted_at` is set, but list them as `{name, deleted_at}`.
- [ ] **Step 4: Deploy with a push to `main`** and watch `gh run watch`. Expected: the Deploy Supabase run succeeds.
- [ ] **Step 5: Smoke test** with `curl -X POST …/functions/v1/api -H 'x-line-id-token: abc' -d '{"action":"myTasks"}'`. Expected: `401 invalid or expired LINE ID token`. The route exists and auth runs first.
- [ ] **Step 6: Commit** with `feat: tasks schema and API`. This goes in the same push as Step 4.

### Task 4: Performance API

**Files:**
- Modify: `supabase/functions/api/tasks-api.ts`

**Interfaces:**
- Consumes: `periodRange`, `memberScores` and `scale` from Task 1.
- Produces: action `performance {kind: "month"|"quarter", year, n}` → `{ from, to, rows: { line_user_id, name, tasks, overall, overall5, byTag: Record<tag, {raw, scaled}> }[] }`.
  - A member gets only their own row. Its scaled values are still computed against all members.
  - An admin gets every member.

- [ ] **Step 1: Implement it.**
  - Select tasks with `state = 'approved'` whose **original** `due_on` falls in `[from, to]` and whose owner has role `member`, together with their sends.
  - Map them to `ScoredTask`, using `outcome`, `sent_on` and `due_on`.
  - Then call `memberScores`, then `scale` over `overall` and over each tag.
- [ ] **Step 2: Deploy and smoke test** as in Task 3. Expected: 401 without a token.
- [ ] **Step 3: Commit** with `feat: performance action`.

### Task 5: Member Work dashboard (home page)

**Files:**
- Create: `js/work.js`
- Modify: `index.html` (the appCard section), `css/app.css`, `Button A/index.html`

**Interfaces:**
- Consumes: `api`, `uploadFile` and `$` from `js/app.js`; the actions `myTasks`, `sendTask` and `performance`.
- Produces: `renderWork(me)`, called from `show(me)` in `index.html` when the user is approved.

- [ ] **Step 1: Implement `js/work.js`.**
  - **Three lists:**
    - *Active*: `on_process`, sorted by `current_due_on`. A task is overdue when `current_due_on < today`, where today comes from `Intl` in Asia/Bangkok, the same as `bangkokDate`. Overdue tasks get the `overdue` class. Tasks with `fix_round > 0` show the last fix note and "รอบแก้ N". When `fix_round > 5`, show the badge "เกิน 5 รอบแก้ไข" (over 5 fix rounds), as the old script did.
    - *Waiting for review*: `submitted`.
    - *Done*: `approved`, newest first.
  - **Task detail** (`<details>` element): building, tags, due dates, a timeline of sends (date, outcome, note) and file links.
  - **Send:** a file input (`multiple`). Upload each file with `uploadFile`, collect the returned `id`s, then call `sendTask`. Disable the button while sending, and re-render on success.
  - **"My performance" card:** this month and this quarter (two `performance` calls). Show `overall5` with 2 decimals and the task count. If there are no tasks, show "-".
  - Keep the existing upload card, but drop the general "My files" list from home: files belong to tasks now.
- [ ] **Step 2: CSS.**
  - One column by default.
  - `@media (min-width: 900px)`: `body { max-width: 1100px }`, with Active and Waiting side by side in two columns.
  - Add `.overdue { border-left: 4px solid #c00 }`.
- [ ] **Step 3: Button A forwarding.** Replace the `<script>` body with `location.replace("../" + location.search)`, and keep a visible link "Open Work" in `<noscript>`.
- [ ] **Step 4: Browser check** using the browser-automation skill with a fake LIFF SDK and fake `api` replies, as in the earlier QA script in this session.
  - A member with one overdue `on_process` task, one `submitted` task and one `approved` task.
  - Expected: three lists with the right counts, the overdue item highlighted, and no console errors.
  - Take screenshots at 390 px and 1280 px width and look at them.
- [ ] **Step 5: Commit** with `feat: member work dashboard`.

### Task 6: Admin tasks page

**Files:**
- Create: `admin/tasks.html`, `js/admin-tasks.js`
- Modify: `index.html` (the admin link list gains "Tasks")

**Interfaces:**
- Consumes: the Task 3 and Task 4 actions; `start("admin")`.

- [ ] **Step 1: Implement the page.**
  - **Create form:** a building `<select>` with an "add building" inline input that calls `addBuilding`; title; details `<textarea>`; tag checkboxes; owner checkboxes from `listMembers`; due date `<input type=date>` with `min` set to today.
  - **Waiting for review:** the result of `listTasks {state: "submitted"}`, oldest send first, with attachments and the "เกิน 5 รอบแก้ไข" badge when `fix_round > 5`.
  - **Review controls** for each item:
    - Buttons **Approved** and **Not approved**.
    - Not approved reveals a `<select>` with options `กดผิด` and `มีปรับแก้`.
    - Choosing `มีปรับแก้` reveals a required `<textarea>` (fix notes) and a required `<input type=date>` (new due date).
    - Submitting calls `reviewTask`. On a 409, show "already reviewed by another admin" and reload.
  - **All tasks:** filters for member, building, state and overdue. Edit and cancel are available only while a task has no sends.
  - **Performance:** a month/quarter switch and a year/n picker, then a table of rows with `overall5` and each tag's scaled value.
- [ ] **Step 2: Browser check** with fakes. Choose Not approved → มีปรับแก้; expect the textarea and date to appear. Submit with an empty note; expect the browser's `required` check to block it. No console errors.
- [ ] **Step 3: Commit** with `feat: admin tasks page`.

### Task 7: Ex Doc library

**Files:**
- Create: `supabase/functions/api/exdocs-api.ts`, `admin/exdoc.html`
- Create: `supabase/migrations/20261108000001_exdocs.sql` (a new file; Task 3's migration is already deployed and must never be edited)
- Modify: `Button C/index.html`, `supabase/functions/api/index.ts`

**Interfaces:**
- Produces:
  - **Member action:** `listExDocs` → `{id, title, name, size, created_at, previewUrl, downloadUrl}[]`, sorted by `title` with `localeCompare(…, "th")`. `downloadUrl` comes from `createSignedUrl(path, 3600, { download: name })`.
  - **Admin actions:**
    - `exdocUploadUrl {name, size}`: rejects anything that isn't `.pdf` or is over 20 MB, then returns `{path, signedUrl}` from `createSignedUploadUrl`.
    - `exdocSave {path, title, name, size}` → row
    - `exdocRename {id, title}`
    - `exdocDelete {id}`: removes the storage object, then the row.
- Schema: `exdocs(id uuid default gen_random_uuid() pk, title text not null check (char_length(title) <= 200), path text not null unique, name text not null, size int not null, uploaded_by text references profiles, created_at timestamptz default now())`, plus bucket `exdocs` (private, 20971520 bytes, `{application/pdf}`) and RLS on.

- [ ] **Step 1: Write the migration and `exdocs-api.ts`.** Route the actions in `index.ts`.
- [ ] **Step 2: Admin page.** Pick a PDF, enter a title (pre-filled from the file name), `PUT` the file to `signedUrl` with `content-type: application/pdf`, then call `exdocSave`. The list gets rename and delete; delete asks for confirmation.
- [ ] **Step 3: Member page.** A search box filters by title on the client. Each row has **Preview** (`<a target=_blank href=previewUrl>`) and **Download** (`<a href=downloadUrl>`).
- [ ] **Step 4: Deploy and smoke test** (401 without a token). Then a browser check of `Button C` with a fake reply of 3 docs: expect A–Z order and search filtering to 1 result.
- [ ] **Step 5: Commit** with `feat: ex doc library`.

### Task 8: Retention with required backup

**Files:**
- Create: `supabase/functions/api/retention.ts`, `supabase/functions/api/retention.test.ts`, `supabase/functions/api/backup-api.ts`, `js/backup.js`
- Modify: `supabase/functions/api/index.ts` (replace `cleanup`), `admin/members.html`, `admin/tasks.html`, `admin/exdoc.html` (load `js/backup.js`)

**Interfaces:**
- Produces:
  - `isDeletable(f: { created_at: string; backed_up_at: string | null; deleted_at: string | null }, now: Date): boolean`
  - `isDue(f, now): boolean`. True when older than 365 days and `deleted_at` is null.
  - **Admin actions:**
    - `backupList` → `{ files: {id, name, owner_name, task_id, created_at, url}[], quotaLow: boolean }`: files that are due and not backed up (signed URLs, 1 hour). `quotaLow` is true when today's `notify_log` has `error = 'quota'`; that table arrives in Task 9, so return `false` until then.
    - `backupDone {ids: string[]}` → `{count}`. Sets `backed_up_at = now()` and `backed_up_by = me`, only for files that are due.
  - The `cleanup` action deletes storage objects only for `isDeletable` files, sets `deleted_at`, and keeps the rows.
  - `initBackupBanner()` in `js/backup.js`: calls `backupList`. When `quotaLow` is true, it shows "LINE quota reached, check the app". If `files` isn't empty, it shows the banner "N files waiting for backup" and a **Download backup** button. That button fetches the URLs, builds a ZIP with JSZip (`https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`) in parts of at most 200 MB, triggers the download, then calls `backupDone` with the IDs in that part.

- [ ] **Step 1: Write the failing tests**

```ts
const now = new Date("2027-06-01T00:00:00Z");
test("young file never deletable", () => assert.equal(isDeletable({ created_at: "2027-01-01T00:00:00Z", backed_up_at: "2027-05-01T00:00:00Z", deleted_at: null }, now), false));
test("old but not backed up -> keep", () => assert.equal(isDeletable({ created_at: "2026-01-01T00:00:00Z", backed_up_at: null, deleted_at: null }, now), false));
test("old and backed up -> delete", () => assert.equal(isDeletable({ created_at: "2026-01-01T00:00:00Z", backed_up_at: "2027-05-01T00:00:00Z", deleted_at: null }, now), true));
test("already deleted -> no", () => assert.equal(isDeletable({ created_at: "2026-01-01T00:00:00Z", backed_up_at: "2027-05-01T00:00:00Z", deleted_at: "2027-05-02T00:00:00Z" }, now), false));
```

- [ ] **Step 2: Run the tests.** Expected: FAIL. **Step 3:** implement. **Step 4:** expect PASS.
- [ ] **Step 5: Wire `backup-api.ts`**, replace `cleanup` in `index.ts`, and add the banner to the three admin pages. Update the upload label in `index.html` from "deleted after 1 year" to "kept at least 1 year; deleted only after an admin backup".
- [ ] **Step 6: Deploy.** Run `curl -d '{"action":"cleanup"}'`. Expected: `{"deleted":0}`.
- [ ] **Step 7: Commit** with `feat: backup-before-delete retention`.

### Task 9: Daily LINE summary

**Files:**
- Create: `supabase/functions/api/digest.ts`, `supabase/functions/api/digest.test.ts`, `supabase/functions/api/notify-api.ts`, `supabase/migrations/20261108000002_notify.sql` (`notify_log` and cron)
- Modify: `supabase/functions/api/index.ts`

**Interfaces:**
- Produces:
  - `memberDigest(x: { newTasks: T[]; dueToday: T[]; overdue: T[]; sentBack: (T & { note: string|null; reason: string })[]; approved: T[] }): string | null`. `T = { title: string; building: string; due: string }`. Returns null when every list is empty. Thai section headers; each list shows at most 10 items, then "+N more".
  - `adminDigest(x: { waiting: (T & { owner: string })[]; backupDue: number; quotaLow: boolean }): string | null`
  - `shouldRunDigest(now: Date, lastRunDate: string | null): boolean`. True only on a Bangkok weekday, at or after 09:00 Bangkok, and when `lastRunDate !== bangkokDate(now)`.
  - The public action `digest`. It's safe to call publicly: it runs at most once per Bangkok weekday after 09:00, otherwise it does nothing.
    - Read the quota: `GET https://api.line.me/v2/bot/message/quota` and `/quota/consumption`.
    - Recipients: admins first, then members. Send to a recipient only while `remaining > 0`.
    - Push with `POST /v2/bot/message/push`: one text message ending with the LIFF link (`https://liff.line.me/2012450429-k3WOCwtO`, plus `/admin/tasks.html` for admins).
    - Log each result to `notify_log`.
    - Set `member_notified_at` on the tasks and sends that were included.
- Schema: `notify_log(id bigint identity pk, run_date date not null, line_user_id text, ok boolean not null, error text, created_at timestamptz default now())`, with RLS on. Cron: `select cron.schedule('daily-digest', '5 2 * * 1-5', $$ select net.http_post(url := 'https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api', headers := '{"content-type":"application/json"}'::jsonb, body := '{"action":"digest"}'::jsonb) $$);`

- [ ] **Step 1: Write the failing tests**

```ts
test("empty member digest -> null", () => assert.equal(memberDigest({ newTasks: [], dueToday: [], overdue: [], sentBack: [], approved: [] }), null));
test("sent back shows reason and note", () => {
  const t = memberDigest({ newTasks: [], dueToday: [], overdue: [], approved: [],
    sentBack: [{ title: "ร่างหนังสือ", building: "อาคาร X", due: "2026-03-15", reason: "มีปรับแก้", note: "แก้ข้อ 2" }] });
  assert.match(t, /มีปรับแก้/); assert.match(t, /แก้ข้อ 2/);
});
test("only weekdays after 09:00 Bangkok, once per day", () => {
  assert.equal(shouldRunDigest(new Date("2026-03-02T01:59:00Z"), null), false); // Mon 08:59
  assert.equal(shouldRunDigest(new Date("2026-03-02T02:05:00Z"), null), true);  // Mon 09:05
  assert.equal(shouldRunDigest(new Date("2026-03-02T05:00:00Z"), "2026-03-02"), false);
  assert.equal(shouldRunDigest(new Date("2026-03-07T03:00:00Z"), null), false); // Sat
});
test("admin digest null when nothing waiting and no backup", () =>
  assert.equal(adminDigest({ waiting: [], backupDue: 0, quotaLow: false }), null));
```

- [ ] **Step 2: Run the tests.** Expected: FAIL. **Step 3:** implement `digest.ts`. **Step 4:** expect PASS.
- [ ] **Step 5: Implement `notify-api.ts`.**
  - If `LINE_MESSAGING_TOKEN` is unset, log one row `{ok:false, error:"no token"}` and return `{sent:0}`.
  - A failed push is logged and the loop continues.
  - The `lastRunDate` is the max `run_date` in `notify_log`.
  - When the quota runs out partway through, log `{ok:false, error:"quota"}` for each recipient skipped. `backup-api.ts` reads that log to set `quotaLow` (see Task 8).
- [ ] **Step 6: Deploy.** Run `curl -d '{"action":"digest"}'`. Expected: on a weekday after 09:00 Bangkok, `{sent:N}`, or `{skipped:"no token"}` until the token is set; otherwise `{skipped:"not now"}`.
- [ ] **Step 7: Commit** with `feat: daily LINE summary with quota guard`.

### Task 10: Import staff and buildings (local, not committed)

**Files:**
- Create (git-ignored): `old-system/make-import.cjs` → output `old-system/import.sql`

- [ ] **Step 1: Write the script** with `xlsx@0.18.5`, installed in the session scratchpad, not in the repo.
  - Read `UserList` (`userId`, `displayName`), `UID` (`OwnerID`, `Responsibility`) and `project_list` (column A).
  - Emit `insert into profiles (line_user_id, display_name, staff_name, role) values … on conflict (line_user_id) do update set staff_name = excluded.staff_name, role = case when profiles.role = 'pending' then 'member' else profiles.role end;`. This never downgrades an admin.
  - Emit `insert into buildings (name) values … on conflict do nothing;`. Trim names, skip blanks, and escape `'` as `''`.
- [ ] **Step 2: Run it.** Expected: `old-system/import.sql` exists, the row counts are printed (staff ≈ 29, buildings ≈ 80), and `git status` doesn't show it.
- [ ] **Step 3: Hand it over.** Tell the owner to paste it into the Supabase SQL Editor once, after Task 3 is deployed.

### Task 11: Docs and rich-menu handover

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README.**
  - The rich-menu table: A can be the plain LIFF URL or `Button%20A/`.
  - The new admin pages.
  - The manual steps: re-issue the bot token, then `npx supabase secrets set LINE_MESSAGING_TOKEN=…` or the dashboard; paste `import.sql`; members must have the bot as a friend.
  - Add a **task review check list**, run by hand after deploying, with two test LINE accounts:
    - Approve works.
    - กดผิด returns the task to On Process with the same due date, and that send doesn't show up in performance.
    - มีปรับแก้ with an empty note is blocked.
    - Two admins approve the same task at once: the second gets the 409 message (Review Focus 2).
    - `sendTask` with another member's `file_id` doesn't attach that file (Review Focus 5).
    - A member who opens `admin/tasks.html` sees no data.
- [ ] **Step 2: Run all tests** with `node --test supabase/functions/api/`. Expected: all PASS.
- [ ] **Step 3: Commit and push.** Expected: the Deploy Supabase run succeeds and the GitHub Pages pages load.
