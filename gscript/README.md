# gscript

The Google Apps Script row store for law_task. The Supabase `api` function calls it; browsers never do. Setup steps: see "Google Sheet setup" in the main README.

| File | Job |
|---|---|
| `Code.js` | Web app (`doPost`), secret check, lock, writes, `setup()`, `selfTest()` |
| `rows.js` | Pure helpers (headers, cell normalizing, all-or-nothing compare-and-set batches), tested with `node --test "gscript/*.test.cjs"` |

**Ops** (POST JSON `{secret, op, ...}`): `read {tabs}`, `append {tab, rows}`, `update {tab, id, patch, expect?}`, `batch {steps}`, `setup`, `replaceMembers {rows}`. A wrong secret gets `{error:"forbidden"}`. An `expect` that no longer matches gets `{conflict:true}` and nothing is written.

**Script properties:** `API_SECRET` (required; same value as Supabase `GSHEET_SECRET`), `SHEET_ID` (only if the script isn't bound to the sheet), `next_id_<Tab>` (id counters; managed by the script, don't edit).

```sh
npx @google/clasp login     # once, opens the browser
npx @google/clasp push      # here -> Google (from this folder), then Deploy -> Manage deployments -> New version
npx @google/clasp pull      # Google -> here
```

**This repo is public.** Commit code only. Never commit sheet data, the sheet ID, the `/exec` URL, or the secret. The old system's script lives in `old-system/script/` (git-ignored); never push to it.
