// Client for the Apps Script row store (gscript/). Reads go through a 60 s cache (below). Secrets GSHEET_URL + GSHEET_SECRET; browsers never call the script.
import { type BuildingRow, buildingRows } from "./responsibility.ts";
import { db, HttpError, must } from "./shared.ts";
import { masked, maskedUrl, normalizeSheetLink, type SheetLink } from "./lineconfig.ts";
import { type Bad, writtenTabs, parseReply, parseSends, parseTasks, type Person, type SendRow, SheetDown, sheetDownHint, type Task, toPeople } from "./sheetRows.ts";

const DOWN = "Google Sheet not reachable, try again";

// ---- Read cache (table sheet_cache, one row per tab) ----
// A read uses a tab's copy if it is under CACHE_MS old; a write through the app deletes the copies of the tabs it
// touched once the script has answered, so the next read is fresh. Hand edits in the sheet show within CACHE_MS.
// shortcut: a read that started before a write and finishes after it can store the old rows again, at most CACHE_MS
// (cached_at = when that read started); add a version check if people ever notice it.
const CACHE_MS = 60_000;
const cache = () => db.from("sheet_cache");

// deno-lint-ignore no-explicit-any
type Payload = Record<string, any>;

/** The Apps Script row store, with the read cache in front. payload.fresh on a read skips the cache (connection check). */
// deno-lint-ignore no-explicit-any
export async function sheet(op: string, payload: Payload = {}, timeoutMs = 10_000): Promise<any> {
  if (op === "read" && !payload.fresh) return cachedRead((payload.tabs ?? []) as string[], timeoutMs);
  const written = writtenTabs(op, payload);
  try {
    return await callScript(op, payload, timeoutMs);
  } finally {
    // also after a failure or timeout: the script may have written anyway
    if (written !== undefined) await dropCache(written);
  }
}

async function cachedRead(tabs: string[], timeoutMs: number) {
  const since = new Date(Date.now() - CACHE_MS).toISOString();
  const { data, error } = await cache().select("tab, rows").in("tab", tabs).gt("cached_at", since);
  if (error) console.error("sheet cache read", error); // cache trouble never breaks a page: read the sheet instead
  const got = new Map<string, unknown>((data ?? []).map((r: { tab: string; rows: unknown }) => [r.tab, r.rows]));
  const missing = tabs.filter((t) => !got.has(t));
  if (missing.length) {
    const started = new Date().toISOString();
    const { tabs: fresh } = await callScript("read", { tabs: missing }, timeoutMs);
    for (const t of missing) got.set(t, fresh[t] ?? []);
    const { error: e } = await cache().upsert(missing.map((tab) => ({ tab, rows: fresh[tab] ?? [], cached_at: started })));
    if (e) console.error("sheet cache write", e);
  }
  return { tabs: Object.fromEntries(tabs.map((t) => [t, got.get(t) ?? []])) };
}

async function dropCache(tabs: string[] | null) {
  const q = cache().delete();
  const { error } = await (tabs ? q.in("tab", tabs) : q.neq("tab", "")); // null = every tab (setup)
  if (error) console.error("sheet cache delete", error);
}

// ---- Which script: ตั้งค่า → การเชื่อมต่อ Google Sheet (app_settings 'gsheet'), else the Supabase secrets ----
let linkCache: { at: number; stored: SheetLink } | null = null;
async function linkStored(): Promise<SheetLink> {
  if (linkCache && Date.now() - linkCache.at < 60_000) return linkCache.stored;
  const { data, error } = await db.from("app_settings").select("value").eq("key", "gsheet").maybeSingle();
  if (error) console.error("gsheet settings", error); // fall back to the Supabase secrets
  linkCache = { at: Date.now(), stored: (data?.value ?? {}) as SheetLink };
  return linkCache.stored;
}
async function sheetLink() {
  const s = await linkStored();
  return { url: s.url || Deno.env.get("GSHEET_URL"), secret: s.secret || Deno.env.get("GSHEET_SECRET") };
}

/** What the admin sees: masked values and where each comes from. */
export async function sheetLinkView() {
  const s = await linkStored(), c = await sheetLink();
  return { url: maskedUrl(c.url), urlSaved: !!s.url, secret: masked(c.secret), secretSaved: !!s.secret };
}

/** Save a new script URL / secret, but only after the script answered a test read with them. */
export async function saveSheetLink(input: unknown, by: string) {
  linkCache = null;
  let value: SheetLink;
  try { value = normalizeSheetLink(input, await linkStored()); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const env = { url: value.url || Deno.env.get("GSHEET_URL"), secret: value.secret || Deno.env.get("GSHEET_SECRET") };
  try {
    const r = await postScript(env, "read", { tabs: ["Buildings"] }, 20_000);
    if (!r.tabs) throw new Error("the script did not answer like the law_task script");
  } catch (e) {
    throw new HttpError(400, `ทดสอบไม่ผ่าน ยังไม่ได้บันทึก: ${sheetDownHint(e instanceof Error ? e.message : String(e))}`);
  }
  must(await db.from("app_settings").upsert({ key: "gsheet", value, updated_at: new Date().toISOString(), updated_by: by }));
  linkCache = null;
  await dropCache(null); // a different sheet: nothing cached from the old one may show
  return sheetLinkView();
}

// deno-lint-ignore no-explicit-any
async function postScript(link: { url?: string; secret?: string }, op: string, payload: Payload, timeoutMs: number): Promise<any> {
  if (!link.url || !link.secret) throw new SheetDown("GSHEET_URL / GSHEET_SECRET not set");
  const r = await fetch(link.url, { method: "POST", body: JSON.stringify({ secret: link.secret, op, ...payload }), signal: AbortSignal.timeout(timeoutMs) });
  return parseReply(r.status, await r.text());
}

// deno-lint-ignore no-explicit-any
async function callScript(op: string, payload: Payload, timeoutMs: number): Promise<any> {
  try {
    return await postScript(await sheetLink(), op, payload, timeoutMs);
  } catch (e) {
    if (e instanceof SheetDown && e.message === "not found") throw new HttpError(404, "task not found"); // row deleted by hand
    console.error("sheet", op, e);
    // say why, so an admin can fix it from the message alone (sheetDownHint never includes the secret or URL)
    throw new HttpError(503, `${DOWN} (${sheetDownHint(e instanceof Error ? e.message : String(e))})`);
  }
}

export type Step =
  | { op: "append"; tab: string; rows: Record<string, string>[] }
  | { op: "update"; tab: string; id: number | string; key?: string; patch: Record<string, string | boolean>; expect?: Record<string, string> }; // key: match column (default id)

/** All steps or none, under one lock. null when an `expect` no longer holds (someone else got there first). */
// deno-lint-ignore no-explicit-any
export async function batch(steps: Step[]): Promise<any[] | null> {
  const r = await sheet("batch", { steps });
  return r.conflict ? null : r.results;
}

export type SheetData = { tasks: Task[]; sends: SendRow[]; buildings: string[]; people: Person[]; bad: Bad[] };

export async function loadPeople(): Promise<Person[]> {
  return toPeople(must(await db.from("profiles").select("line_user_id, role, staff_name, display_name")));
}

export async function loadBuildings(): Promise<string[]> {
  return (await loadBuildingRows()).map((b) => b.name);
}

/** Buildings with their type and owner (the หัวหน้างาน who looks after it). */
export async function loadBuildingRows(): Promise<BuildingRow[]> {
  const { tabs } = await sheet("read", { tabs: ["Buildings"] });
  return buildingRows(tabs.Buildings);
}

const names = (rows: { name?: string }[]) =>
  [...new Set(rows.map((b) => String(b.name ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));

/** Everything a task page needs: one sheet read + profiles. Hand reassignments are written back (best effort). */
export async function loadSheet(): Promise<SheetData> {
  const [{ tabs }, people] = await Promise.all([sheet("read", { tabs: ["Tasks", "Sends", "Buildings"] }), loadPeople()]);
  const buildings = names(tabs.Buildings);
  const t = parseTasks(tabs.Tasks, new Set(buildings), people);
  const s = parseSends(tabs.Sends, new Set(t.tasks.map((x) => x.id)));
  if (t.reassigned.length) {
    // expect owner_name: if someone changed it again meanwhile, skip; the next read retries.
    await batch(t.reassigned.map((x) => ({
      op: "update" as const, tab: "Tasks", id: x.id,
      patch: { owner_id: x.owner, member_notified_at: "" }, expect: { owner_name: x.owner_name },
    }))).catch((e) => console.error("reassign write-back", e));
  }
  return { tasks: t.tasks, sends: s.sends, buildings, people, bad: [...t.bad, ...s.bad] };
}

/** Members tab = read-only mirror of everyone with a login (dropdown source for hand edits). */
export async function syncMembers(people: Person[]) {
  await sheet("replaceMembers", { rows: people.map(({ line_user_id, name, role }) => ({ line_user_id, name, role })) });
}

/** The live script is older than this code (Apps Script not redeployed: Deploy → New version). */
export const isUnknownOp = (e: unknown) => e instanceof Error && /unknown op/.test(e.message);
/** Uploads to Drive when the script is older than this code: say what to do instead of "unknown op". */
export const scriptTooOld = (e: unknown) => {
  if (isUnknownOp(e)) throw new HttpError(503, "ยังแนบไฟล์ไม่ได้: แอดมินต้อง Deploy → New version ใน Apps Script ก่อน");
  throw e;
};
