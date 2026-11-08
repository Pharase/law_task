# Google Sheets Task Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks, sends and buildings live in a Google Sheet (source of truth) instead of Supabase tables; the web app behaves the same.

**Architecture:** An Apps Script web app (`gscript/`) is a thin, secret-protected row store with a lock. The Supabase `api` function keeps every rule: it reads the sheet, validates rows with a pure tested module (`sheetRows.ts`), and writes through compare-and-set (`expect`) updates batched under one lock. Logins, invites, files, Ex Docs and notify_log stay in Supabase.

**Tech Stack:** Google Apps Script (V8, clasp), Deno Edge Function (TypeScript), Node 22 `node --test` for pure modules, vanilla JS pages.

**Spec:** `docs/superpowers/specs/2026-11-08-gsheet-storage-design.md` (approved 2026-11-08)

## Global Constraints

- The repo is **public**: no secrets, sheet IDs, URLs with deployment IDs, personal data, building or client names in commits. Never open `old-system/` or `test/` (real personal data).
- Secrets: Script Property `API_SECRET` == Supabase secret `GSHEET_SECRET`; Supabase secret `GSHEET_URL` = the `/exec` URL. CI does not set them.
- Script answers `{error:"forbidden"}` and touches nothing when the secret is wrong.
- Every sheet call from `api`: 10 s timeout; any failure (timeout, non-JSON reply, `{error}`) → HTTP 503 `"Google Sheet not reachable, try again"`.
- Dates in and out of the sheet are `YYYY-MM-DD` (Gregorian, Asia/Bangkok). Blank `current_due_on` = use `due_on`; blank `fix_round` = 0.
- New `id`s come from a per-tab counter in Script Properties (`next_id_<Tab>`), never max+1.
- Tabs and headers exactly:
  - `Tasks`: id, building, title, details, tags, owner_id, owner_name, state, due_on, current_due_on, fix_round, created_by, created_at, member_notified_at
  - `Sends`: id, task_id, sent_on, sent_at, due_on, outcome, fix_note, next_due_on, reviewed_by, reviewed_at, member_notified_at
  - `Buildings`: name
  - `Members`: line_user_id, name, role
- `tags` cell = tags joined by `", "`, each from `TAGS` in `review.ts`.
- Page-facing action names and response shapes stay as today, except `building_id` → `building` (name) and the new admin action `sheetWarnings`.
- Tests: `node --test "supabase/functions/api/*.test.ts" "gscript/*.test.cjs"`; type check `npx -y deno@2.1.4 check supabase/functions/api/index.ts`.

## Review Focus

1. A date cell that comes back as a Date object or a Buddhist-era year (`2569-11-20`) → normalized to `2026-11-20`, never a crash (Task 1 `normCell`, Task 3 `normDate` tests).
2. The script replying with an HTML page (not authorized yet, or a Google error) → 503 with the friendly message, not a 500 (Task 3 `parseReply` test).
3. Two admins reviewing, or a member double-tapping Send, at the same time → exactly one wins, the other gets 409, and no half-written send (Task 1 `planBatch` conflict test).
4. A hand-deleted Tasks row whose Sends and files remain → those sends are ignored, the pages still load (Task 3 `parseSends` test).
5. A hand-typed `owner_name` that matches nobody, two people, or an admin → row flagged and left out, `owner_id` unchanged (Task 3 reassignment tests).

---

### Task 1: Apps Script row store (pure core + web app)

**Files:**
- Create: `gscript/rows.js` (pure helpers, no Google APIs; exports via `if (typeof module !== "undefined") module.exports = {...}`)
- Create: `gscript/Code.js` (doPost, ops, setup, selfTest — Google APIs)
- Delete: `gscript/รหัส.js`
- Modify: `gscript/appsscript.json` — `"webapp": {"executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS"}`, `"oauthScopes"` left implicit
- Modify: `.github/workflows/supabase-deploy.yml:25` — test step runs both globs (see Global Constraints); add `gscript/**` to the workflow's `paths` trigger
- Test: `gscript/rows.test.cjs`

**Interfaces:**
- Produces (script HTTP API, POST JSON body `{secret, op, ...}`, reply JSON):
  - `read {tabs: string[]}` → `{tabs: {[tab]: Row[]}}`, `Row` = header-keyed strings plus `_row` (sheet row number)
  - `append {tab, rows: object[]}` → `{rows: Row[]}` (id assigned only if the tab has an `id` header)
  - `update {tab, id, patch, expect?}` → `{row}` or `{conflict: true}` or `{error: "not found"}`
  - `batch {steps: ({op:"append",tab,rows} | {op:"update",tab,id,patch,expect?})[]}` → `{results: (Row[] | Row)[]}` or `{conflict: true}` — all or nothing, one lock
  - `setup {}` → `{ok: true}`; `replaceMembers {rows}` → `{ok: true}`
  - any op with wrong secret → `{error: "forbidden"}`
- Produces (rows.js): `HEADERS`, `normCell(v): string`, `toObjects(values: any[][]): Row[]`, `planBatch(steps, tables, nextId): {conflict:true} | {writes, results}`

- [ ] **Step 1: Write the failing tests** in `gscript/rows.test.cjs` (load with `require("./rows.js")`):
  - `normCell(new Date(2026, 10, 20))` → `"2026-11-20"`; `normCell(3)` → `"3"`; `normCell(null)` → `""`
  - `toObjects([["id","title"],[1,"A"],["",""]])` → `[{id:"1",title:"A",_row:2}]` (fully blank rows skipped)
  - `planBatch` update with matching `expect` → one write, result row has the patch applied
  - `planBatch` with two steps where the second's `expect` fails → `{conflict:true}` and **no** writes (all or nothing)
  - `planBatch` append on a tab with `id` header → ids `nextId("Sends")`, consecutive; on `Buildings` → no id
  - update of a missing id → `{error:"not found"}`
- [ ] **Step 2: Run** `node --test "gscript/*.test.cjs"` — Expected: FAIL, `Cannot find module './rows.js'`
- [ ] **Step 3: Implement `gscript/rows.js`.** `normCell`: Date → local `yyyy-MM-dd` (Apps Script runs in the project's Asia/Bangkok zone; use `getFullYear/getMonth/getDate`), others `String(v ?? "")`. `planBatch(steps, tables, nextId)`: `tables` = `{[tab]: {headers, rows: Row[]}}`; work on a copy, apply each step in order (later steps see earlier ones), return `writes` = `[{tab, kind:"append"|"update", row}]` only if every step succeeded. `nextId(tab)` is injected so the counter stays in Code.js.
- [ ] **Step 4: Run** `node --test "gscript/*.test.cjs"` — Expected: PASS
- [ ] **Step 5: Implement `gscript/Code.js`:** `doPost(e)` parses JSON, compares `secret` with `PropertiesService.getScriptProperties().getProperty("API_SECRET")` (missing property also → forbidden), takes `LockService.getScriptLock().waitLock(10000)` for writes, dispatches, returns `ContentService.createTextOutput(JSON.stringify(x)).setMimeType(JSON)`; errors → `{error: message}`. Spreadsheet: `SpreadsheetApp.getActive() || SpreadsheetApp.openById(props.getProperty("SHEET_ID"))` (the clasp config has no `parentId`, so the script may be standalone). `update`/`append`/single ops go through `planBatch` too, so there is one write path. Counters: `next_id_<Tab>` property, initialised to max existing id + 1 on first use. `setup()`: create missing tabs with `HEADERS`, freeze row 1, set date columns' number format to `@` (plain text, so hand-typed dates stay `YYYY-MM-DD`), dropdowns (`building` ← `Buildings!A2:A`, `owner_name` ← `Members!B2:B`, `state` ← the 4 states), warning-only protection (`protect().setWarningOnly(true)`) on Tasks app columns and the whole Sends and Members tabs. `selfTest()`: on a scratch tab `_selftest`, append 2 rows, update with good expect, update with bad expect → conflict, then delete the tab; `Logger.log` each result and throw on a mismatch.
- [ ] **Step 6: Push the code** `cd gscript && npx -y @google/clasp push --force` — Expected: lists `appsscript.json`, `Code.js`, `rows.js` pushed. (Target is the new empty script the owner provided; never the root/old-system clasp config.)
- [ ] **Step 7: Commit** `git add gscript .github/workflows/supabase-deploy.yml && git commit -m "feat(gscript): secret-protected row store with compare-and-set batch"`

### Task 2: Drop the Supabase task tables

**Files:**
- Create: `supabase/migrations/20261109000000_tasks_to_sheet.sql`

- [ ] **Step 1: Write the migration:** `update files set task_id = null, send_id = null where task_id is not null;` (old test ids would collide with new sheet ids), then `drop table task_sends, tasks, buildings cascade;` (cascade drops the `files` foreign keys; the integer columns stay).
- [ ] **Step 2: Check** `grep -rn "task_sends\|from(\"tasks\")\|from(\"buildings\")" supabase/functions` — Expected: matches only in `tasks-api.ts` and `notify-api.ts` (rewritten in Tasks 4–5). Do not deploy alone; CI deploys on merge.
- [ ] **Step 3: Commit** `git commit -m "feat(db): drop task tables; tasks live in the Google Sheet"`

### Task 3: `sheetRows.ts` — validate and map sheet rows (pure)

**Files:**
- Create: `supabase/functions/api/sheetRows.ts` (no Deno or npm imports, so node can test it)
- Test: `supabase/functions/api/sheetRows.test.ts`

**Interfaces:**
- Consumes: `TAGS` from `review.ts`; `Send` type from `scoring.ts`
- Produces:
  - `type Person = { line_user_id: string; name: string; role: string }` (name = staff_name || display_name)
  - `type Task = { id: number; sheetRow: number; building: string; title: string; details: string | null; tags: string[]; owner: string; owner_name: string; state: "on_process"|"submitted"|"approved"|"cancelled"; due_on: string; current_due_on: string /* effective */; fix_round: number; created_by: string; created_at: string; member_notified_at: string | null }`
  - `type SendRow = { id: number; task_id: number; sent_on: string; sent_at: string; due_on: string; outcome: "pending"|"approved"|"void"|"fix"; fix_note: string | null; next_due_on: string | null; reviewed_by: string | null; reviewed_at: string | null; member_notified_at: string | null }`
  - `type Bad = { row: number; tab: string; reason: string }`
  - `normDate(v: string): string | null`
  - `parseTasks(rows: Row[], buildings: Set<string>, people: Person[]): { tasks: Task[]; bad: Bad[]; reassigned: { id: number; owner: string; owner_name: string }[] }`
  - `parseSends(rows: Row[], taskIds: Set<number>): { sends: SendRow[]; bad: Bad[] }`
  - `scoredSends(task: Task, sends: SendRow[]): Send[]`
  - `taskCells(t: Partial<Task>): Record<string, string>` (tags → `", "` joined, null → `""`)
  - `parseReply(status: number, text: string): unknown` — throws `SheetDown` (exported `class SheetDown extends Error`)

- [ ] **Step 1: Write the failing tests:**
  - `normDate("2026-11-20")` → same; `normDate("2569-11-20")` → `"2026-11-20"`; `normDate("20/11/2026")` → `null`; `normDate("")` → `null`
  - good row parses; `current_due_on` blank → equals `due_on`; `fix_round` blank → `0`; tags `"การประสานงาน, ความถูกต้อง"` → array of 2
  - bad rows → in `bad` with the sheet row number, not in `tasks`: missing title; `due_on` `"tomorrow"`; unknown state; unknown tag; building not in the set
  - owner_name matches one member with a different id → task `owner` = new id, `member_notified_at` null, entry in `reassigned`
  - owner_name matches nobody / two people / an admin → `bad`, nothing in `reassigned`
  - a revoked person's name is valid (no flag)
  - `parseSends`: a send whose `task_id` isn't in `taskIds` is dropped silently (not in `bad`); unknown outcome → `bad`
  - `scoredSends`: round 0 uses the task's **current** `due_on` (not the Sends copy); after a `fix` send with `next_due_on` X, the next send's `dueOn` = X; void sends keep their round's due
  - `parseReply(200, "<html>…")` throws `SheetDown`; `parseReply(200, '{"error":"forbidden"}')` throws; `parseReply(500, "{}")` throws; `parseReply(200, '{"rows":[]}')` returns the object
- [ ] **Step 2: Run** `node --test supabase/functions/api/sheetRows.test.ts` — Expected: FAIL, module not found
- [ ] **Step 3: Implement `sheetRows.ts`** to the interfaces above. Owner rule: if `owner_name` matches exactly one person → admin ⇒ bad("owner is an admin"); id differs ⇒ reassign; else keep. Zero or 2+ matches ⇒ bad.
- [ ] **Step 4: Run** the full test command (Global Constraints) — Expected: all PASS
- [ ] **Step 5: Commit** `git commit -m "feat(api): validate and map Google Sheet rows"`

### Task 4: `sheet.ts` client + task actions on the sheet

**Files:**
- Create: `supabase/functions/api/sheet.ts`
- Modify: `supabase/functions/api/tasks-api.ts` (whole file: database task calls → sheet)

**Interfaces:**
- Consumes: Task 1 HTTP API; Task 3 exports; `db`, `bucket`, `HttpError`, `must`, `found`, `Me` from `shared.ts`
- Produces (sheet.ts):
  - `sheet(op: string, payload: object): Promise<any>` — POST to `GSHEET_URL` with `GSHEET_SECRET`, `AbortSignal.timeout(10_000)`, `parseReply`; `SheetDown`/fetch errors → `HttpError(503, "Google Sheet not reachable, try again")`
  - `batch(steps): Promise<any[]>` — `{conflict}` → returns `null`
  - `loadSheet(): Promise<{ tasks: Task[]; sends: SendRow[]; buildings: string[]; people: Person[]; bad: Bad[] }>` — one `read {tabs:["Tasks","Sends","Buildings"]}` + `profiles` from Supabase (all roles), parses, and if `reassigned` is non-empty writes `owner_id`, blank `member_notified_at` back in one batch with `expect: {owner_name}` (a conflict is ignored; next read retries)
  - `syncMembers(people: Person[]): Promise<void>` → `replaceMembers`
- Produces (tasks-api.ts): same actions as today, plus admin `sheetWarnings` → `Bad[]`. `listBuildings` → `{name}[]`. `createTask`/`editTask` take `building` (name, must be in Buildings); `listTasks` filter `building`. Task objects keep today's shape: task fields + `owner`, `owner_name`, `building`, `sends`, `files`.

- [ ] **Step 1: Implement `sheet.ts`** (env read inside `sheet()`, not at module top).
- [ ] **Step 2: Rewrite `tasks-api.ts`:**
  - `loadTasks(pred)` → `loadSheet()`, filter, attach sends and Supabase `files` by `task_id` (signed URLs as today), sort by `current_due_on`.
  - `sendTask`: `canSend` check, then `batch([update Tasks {state:"submitted"} expect {state:"on_process"}, append Sends {task_id, sent_on: today, sent_at: ISO, due_on: task.current_due_on, outcome:"pending"}])`; `null` → 409 "already sent"; attach files with the returned send id exactly as today.
  - `reviewTask`: find the task's `pending` send; batch the task update (expect `state:"submitted"`; patch state, fix_round, and `current_due_on` only for มีปรับแก้) **with** the send update (expect `outcome:"pending"`) in one batch; `null` → 409 "already reviewed by another admin". This makes the deferred "not atomic" minor go away.
  - `editTask`: 409 if any send; patch `due_on` only (leave `current_due_on` blank); expect `state:"on_process"`.
  - `cancelTask`: state must be on_process/submitted else 404 "open task"; batch task → cancelled (expect the state read) + pending send → void.
  - `createTask`: owners must be `role = member` in `profiles`; append one row per owner with `owner_name` = their name, `fix_round` 0, `current_due_on` blank.
  - `addBuilding`: return existing name if present (case-sensitive trim match), else append to Buildings.
  - `listMembers`: unchanged query, then `syncMembers(all profiles)` (Members mirror refresh on every admin page open).
  - `performance`: approved tasks with `due_on` in the period whose owner is **not an admin** in profiles (revoked people still count, per spec), sends via `scoredSends`.
  - `sheetWarnings` (admin): `(await loadSheet()).bad`.
- [ ] **Step 3: Type check** `npx -y deno@2.1.4 check supabase/functions/api/index.ts` — Expected: no errors (notify-api errors are fixed in Task 5; if they block, do Task 5 before checking).
- [ ] **Step 4: Run** the full test command — Expected: all PASS
- [ ] **Step 5: Commit** `git commit -m "feat(api): task actions read and write the Google Sheet"`

### Task 5: Daily summary on the sheet

**Files:**
- Modify: `supabase/functions/api/notify-api.ts:52-102`

- [ ] **Step 1:** Replace the `tasks` / `task_sends` queries with `loadSheet()`: open = tasks in on_process/submitted/approved; reviewed = sends with outcome fix/void/approved and blank `member_notified_at`; `asT` uses `t.building`; owner names from `owner_name`. Replace the two `member_notified_at` updates with one `batch` of `update` steps (no `expect`) per message.
- [ ] **Step 2: Type check + full tests** — Expected: deno check clean, all tests PASS.
- [ ] **Step 3: Commit** `git commit -m "feat(api): daily summary reads the Google Sheet"`

### Task 6: Pages and docs

**Files:**
- Modify: `js/admin-tasks.js` (building option values = names; `createTask`/`listTasks` send `building`; `addBuilding` reselects by name; load `sheetWarnings`)
- Modify: `admin/tasks.html` (a `<section class="card" id="warnCard" hidden>` with `<h2>ข้อมูลในชีตที่ต้องแก้ · Sheet rows to fix</h2><ul id="warnList"></ul>` above the review list)
- Modify: `README.md` (go-live: Google Sheet setup), `gscript/README.md` (script ID, ops, secret)

- [ ] **Step 1: Edit the page.** Warnings render as `Sheet "<tab>" row <row>: <reason>`; the card stays hidden when the list is empty.
- [ ] **Step 2: Browser QA** with the browser-automation skill against a local static server, stubbed LIFF and stubbed api (`listBuildings` → `[{name:"Bldg 1"}]`, `sheetWarnings` → one Bad): Expected: building dropdown shows "Bldg 1"; createTask request body contains `"building":"Bldg 1"`; warning card visible with the row text; no console errors.
- [ ] **Step 3: README owner steps** (in order): create the Google Sheet and open Extensions → Apps Script **or** set Script Property `SHEET_ID` for the standalone script; Script Property `API_SECRET` = a long random string; run `setup` once in the editor (authorizes); run `selfTest`; Deploy → New deployment → Web app (Execute as me, Anyone); `npx supabase secrets set GSHEET_URL=<exec url> GSHEET_SECRET=<same string>`; then merge. Note that until then the Work pages show the 503 message.
- [ ] **Step 4: Full tests + deno check** — Expected: PASS / clean.
- [ ] **Step 5: Commit** `git commit -m "feat(pages): buildings by name, sheet row warnings; docs for sheet setup"`

---

## Notes against the spec

- Spec "a name rename made in the app rewrites owner_name": the app has no rename action today, so nothing to build. If one is added later, it must rewrite `owner_name` on that person's Tasks rows.
- Reassignment matching uses Supabase `profiles` directly (the source of truth); the Members tab is only the dropdown mirror for hand edits.

## Rollout

Build on branch `gsheet-storage`. Do not merge until the owner has finished the README sheet steps (Task 6 Step 3); merging runs the migration (drops the test-only task tables) and deploys the new `api`. After merge: re-run the README manual checks, plus "edit a title by hand → app shows it" and "type a bad date by hand → admin sees the row warning".
