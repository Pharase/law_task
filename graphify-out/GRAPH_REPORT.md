# Graph Report - TaskManagerSystem  (2026-11-12)

## Corpus Check
- 90 files · ~67,592 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 19 file(s) not represented in the graph (top: .woff2 15, .css 2, (none) 1)

## Summary
- 592 nodes · 1539 edges · 20 communities (16 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 140 edges (avg confidence: 0.9)
- Token cost: 473,297 input · 27,000 output

## Community Hubs (Navigation)
- Storage and Review Rules Plan
- LIFF Pages and Task Tracking
- Architecture, Access and Deploy
- Ex Doc Page Logic
- Google Sheets Task Store
- LINE Notices and Daily Digest
- Reports and Admin Tasks UI
- Dates and Performance Scoring
- Retention and Backup
- Invoices
- Property Liens
- Apps Script Demo Data
- Admin Members Page
- Property Right Page UI
- Apps Script Manifest
- NPM Dependencies
- Background Mark Image
- Logo Image
- Task Hero Image
- Font Licence

## God Nodes (most connected - your core abstractions)
1. `HttpError` - 33 edges
2. `adminTaskActions()` - 30 edges
3. `sheet()` - 24 edges
4. `loadSheet()` - 21 edges
5. `must()` - 20 edges
6. `law_task README` - 18 edges
7. `digest()` - 17 edges
8. `batch()` - 17 edges
9. `loadDocs() list documents by group with edit controls` - 17 edges
10. `law_task LINE LIFF App Architecture (Pages -> api Edge Function -> Sheet/Postgres/Storage)` - 17 edges

## Surprising Connections (you probably didn't know these)
- `nameOf() user display name` --semantically_similar_to--> `memberLabel()`  [INFERRED] [semantically similar]
  admin/members.html → js/admin-tasks.js
- `openForm() add/edit invoice form` --semantically_similar_to--> `isAllBuilding()`  [INFERRED] [semantically similar]
  Button F/index.html → js/admin-tasks.js
- `h() DOM element helper` --semantically_similar_to--> `el()`  [INFERRED] [semantically similar]
  Button E/index.html → js/work.js
- `uploadOne() signed-URL upload to Storage then save row` --semantically_similar_to--> `uploadFile()`  [INFERRED] [semantically similar]
  admin/exdoc.html → js/app.js
- `All Dates Are Asia/Bangkok Calendar Dates (never UTC toISOString slice)` --references--> `bangkokDate()`  [INFERRED]
  docs/superpowers/plans/2026-11-08-task-tracking-exdoc.md → supabase/functions/api/dates.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Example Document library: admin upload/grouping and member browsing share listExDocs + groupDocs/docsBySubgroup** — admin_exdoc_loaddocs, admin_exdoc_uploadone, admin_exdoc_folder_upload, button_c_index_render, js_work_groupdocs, js_work_docsbysubgroup, supabase_functions_api_index_listexdocs [EXTRACTED 1.00]
- **Admin-only pages gated by start("admin") with backup banner** — admin_exdoc, admin_members, admin_tasks, js_app_start, js_backup_initbackupbanner [EXTRACTED 1.00]
- **Member onboarding: LINE login, pending approval, invite code create/redeem, role set, unlock** — index_show, index_redeem_code, admin_members_invite, admin_members_pendingrow, supabase_functions_api_index_createinvite, supabase_functions_api_index_redeem, supabase_functions_api_index_setrole, supabase_functions_api_index_unlock [INFERRED 0.85]
- **Task Review State Machine (send, approve, wrong-press void, needs-fix round)** — docs_superpowers_specs_2026_11_08_task_tracking_exdoc_design_task_states, docs_superpowers_specs_2026_11_08_task_tracking_exdoc_design_review_reasons, readme_task_flow, docs_superpowers_plans_2026_11_08_task_tracking_exdoc_task_2_review_rules, supabase_functions_api_review_validatereview, supabase_functions_api_review_revieweffect, supabase_functions_api_review_cansend [INFERRED 0.85]
- **Sheet Write Safety Without Transactions (secret, lock, compare-and-set, batch, id counter)** — docs_superpowers_specs_2026_11_08_gsheet_storage_design_shared_secret_access, docs_superpowers_specs_2026_11_08_gsheet_storage_design_compare_and_set_update, docs_superpowers_specs_2026_11_08_gsheet_storage_design_batch_op_one_lock, docs_superpowers_specs_2026_11_08_gsheet_storage_design_per_tab_id_counter, gscript_rows_planbatch, gscript_code_withlock, supabase_functions_api_sheet_batch [INFERRED 0.85]
- **Performance Scoring Pipeline (day score -> task score -> member score -> 1-5 scale)** — docs_superpowers_specs_2026_11_08_task_tracking_exdoc_design_day_score_formula, docs_superpowers_specs_2026_11_08_task_tracking_exdoc_design_performance_scoring, docs_superpowers_specs_2026_11_08_task_tracking_exdoc_design_one_to_five_scale, supabase_functions_api_scoring_dayscore, supabase_functions_api_scoring_taskscore, supabase_functions_api_scoring_memberscores, supabase_functions_api_scoring_scale, supabase_functions_api_sheetrows_scoredsends [INFERRED 0.85]

## Communities (20 total, 4 thin omitted)

### Community 0 - "Storage and Review Rules Plan"
Cohesion: 0.07
Nodes (73): Sheet Plan Task 2: Drop the Supabase Task Tables, Sheet Plan Task 3: sheetRows.ts Validate and Map Sheet Rows, Sheet Plan Task 4: sheet.ts Client + Task Actions on the Sheet, Task Plan Review Focus (foreign task 403, double review, Bangkok day, fix validation, foreign file ids), Task Plan Task 2: Review Rules (pure), Task Plan Task 3: Schema and Task API (buildings, tasks, task_sends tables), Members Tab: Read-only Mirror of Supabase profiles, 503 'Google Sheet not reachable, try again' (10 s timeout) (+65 more)

### Community 1 - "LIFF Pages and Task Tracking"
Cohesion: 0.06
Nodes (56): Admin Ex Doc page (upload, group, rename, delete documents), uploadOne() signed-URL upload to Storage then save row, Admin Tasks tracking page (review queue, all tasks, sheet warnings), Button A page (rich menu A, redirects to Home), Button C page: Example Document (member view), Button E page: Property Right (lien summary per building), Button F page: Invoices, Task Plan Task 10: Import Staff and Buildings (local, not committed) (+48 more)

### Community 2 - "Architecture, Access and Deploy"
Cohesion: 0.07
Nodes (43): Task Plan Task 7: Ex Doc Library, Button C: Ex Doc Library (private exdocs bucket, signed URLs, never auto-deleted), Deploy Supabase workflow (GitHub Actions), deploy job: node --test, supabase db push, secrets set LINE_CHANNEL_ID, functions deploy api, law_task LINE LIFF App Architecture (Pages -> api Edge Function -> Sheet/Postgres/Storage), CODE_CHARS, newCode(), normalizeCode() (+35 more)

### Community 3 - "Ex Doc Page Logic"
Cohesion: 0.06
Nodes (49): Whole-folder upload (folderGo handler, skips already uploaded files), groupButtons() rename/delete group buttons (edit mode), groupSelect() group dropdown, kb() file size text, loadDocs() list documents by group with edit controls, makePlan() folder upload plan (group/subfolder per file), OK_TYPE allowed upload extensions, run() do an action then reload docs (+41 more)

### Community 4 - "Google Sheets Task Store"
Cohesion: 0.09
Nodes (41): Google Sheets Task Store Implementation Plan, Sheet Plan Global Constraints (public repo, secrets, 10 s timeout, exact tab headers), Sheet Plan Review Focus (BE dates, HTML reply, concurrent review, orphan sends, bad owner_name), Sheet Plan Task 1: Apps Script Row Store (rows.js + Code.js), Sheet Plan Task 5: Daily Summary on the Sheet, Sheet Plan Task 6: Pages and Docs (buildings by name, sheet row warnings), Google Sheets as the Task Store: Design Spec, Date Cell Normalization to YYYY-MM-DD (Date objects, Buddhist-era years) (+33 more)

### Community 5 - "LINE Notices and Daily Digest"
Cohesion: 0.10
Nodes (41): Task Plan Task 9: Daily LINE Summary (digest action, notify_log, cron), LINE Quota Guard (check quota, admins first, banner when reached), Instant LINE Notice on Assign (08:30-17:30 Bangkok, else next daily summary), bangkokDate(), adminDigest(), bkkParts, dueSoon(), isWorkingHours() (+33 more)

### Community 6 - "Reports and Admin Tasks UI"
Cohesion: 0.13
Nodes (35): Button D page: Reports (activity chart, monthly reports, performance), Task Plan Task 6: Admin Tasks Page, AC_SERIES, activityBins(), adminTaskBody(), binLabel(), binTitle(), bkkDay() (+27 more)

### Community 7 - "Dates and Performance Scoring"
Cohesion: 0.13
Nodes (21): Task Tracking and Ex Doc Library Implementation Plan, Task Plan Task 1: Dates and Scoring (pure), Task Plan Task 4: Performance API, Day Score Formula: 10 if on time, else max(0, 10 - late/3), 1-5 Scale: 1 + 4 x (x - min) / (max - min) Over Members in the Period, TAG_LIST, bkk, daysBetween() (+13 more)

### Community 8 - "Retention and Backup"
Cohesion: 0.15
Nodes (20): Task Plan Task 8: Retention With Required Backup, archiveFiles(), base64(), Row, adminBackupActions(), cleanup(), quotaLow(), Row (+12 more)

### Community 9 - "Invoices"
Cohesion: 0.15
Nodes (22): adminInvoiceActions(), loadInvoices(), memberInvoiceActions(), BUILDING_TYPES, cell(), DATE_FIELDS, Invoice, INVOICE_STATUS (+14 more)

### Community 10 - "Property Liens"
Cohesion: 0.15
Nodes (21): adminLienActions(), detail(), kindOf(), load(), memberLienActions(), summary(), BOOLS, cell() (+13 more)

### Community 11 - "Apps Script Demo Data"
Cohesion: 0.11
Nodes (14): clearDemo(), demoPlan_(), seedDemo(), members, plan, Demo Data (seedDemo / clearDemo), Claims, LineProfile (+6 more)

### Community 12 - "Admin Members Page"
Cohesion: 0.14
Nodes (21): Admin Members page (approvals, organization, LINE test), act() call an API action then reload users, avatar() picture or initial, invite() create and show an invite code, loadUsers() pending list and organization list, nameOf() user display name, orgRow() member row with role change / revoke, pendingRow() approve / invite / unlock a waiting user (+13 more)

### Community 13 - "Property Right Page UI"
Cohesion: 0.16
Nodes (17): bar() progress bar, building() expandable building row, chip() count chip, editRow() inline status edit form, saves only changed fields, empty() row with all-zero counts, fillAll() store summary and render both kinds, fillKind() render condo or village list, h() DOM element helper (+9 more)

### Community 14 - "Apps Script Manifest"
Cohesion: 0.25
Nodes (7): dependencies, exceptionLogging, runtimeVersion, timeZone, webapp, access, executeAs

### Community 15 - "NPM Dependencies"
Cohesion: 0.33
Nodes (5): dependencies, @supabase/ssr, @supabase/supabase-js, @supabase/ssr, @supabase/supabase-js

## Ambiguous Edges - Review These
- `renderHome()` → `Task Plan Task 5: Member Work Dashboard (home page)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-11-08-task-tracking-exdoc.md · relation: references

## Knowledge Gaps
- **34 isolated node(s):** `@supabase/ssr`, `@supabase/supabase-js`, `Deploy Supabase workflow (GitHub Actions)`, `busy() button busy state`, `pct() done/todo percent` (+29 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 128 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `law_task LINE LIFF App Architecture (Pages -> api Edge Function -> Sheet/Postgres/Storage)` connect `Architecture, Access and Deploy` to `Storage and Review Rules Plan`, `LIFF Pages and Task Tracking`, `Google Sheets Task Store`, `LINE Notices and Daily Digest`, `Dates and Performance Scoring`, `Retention and Backup`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `adminTaskActions()` (e.g. with `index.ts` and `syncMembers()`) actually correct?**
  _`adminTaskActions()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@supabase/ssr`, `@supabase/supabase-js`, `Deploy Supabase workflow (GitHub Actions)` to the rest of the system?**
  _34 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Storage and Review Rules Plan` be split into smaller, more focused modules?**
  _Cohesion score 0.06554621848739496 - nodes in this community are weakly interconnected._
- **Why does `Adding a Feature Convention (page: start + api + textContent; backend: <feature>-api.ts handlers)` connect `LIFF Pages and Task Tracking` to `Architecture, Access and Deploy`, `Ex Doc Page Logic`, `Dates and Performance Scoring`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Should `LIFF Pages and Task Tracking` be split into smaller, more focused modules?**
  _Cohesion score 0.05792349726775956 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `renderHome()` and `Task Plan Task 5: Member Work Dashboard (home page)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._