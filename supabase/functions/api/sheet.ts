// Client for the Apps Script row store (gscript/). Secrets GSHEET_URL + GSHEET_SECRET; browsers never call the script.
import { db, HttpError, must } from "./shared.ts";
import { type Bad, parseReply, parseSends, parseTasks, type Person, type SendRow, SheetDown, type Task, toPeople } from "./sheetRows.ts";

const DOWN = "Google Sheet not reachable, try again";

// deno-lint-ignore no-explicit-any
export async function sheet(op: string, payload: object = {}): Promise<any> {
  const url = Deno.env.get("GSHEET_URL"), secret = Deno.env.get("GSHEET_SECRET");
  try {
    if (!url || !secret) throw new SheetDown("GSHEET_URL / GSHEET_SECRET not set");
    const r = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ secret, op, ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
    return parseReply(r.status, await r.text());
  } catch (e) {
    if (e instanceof SheetDown && e.message === "not found") throw new HttpError(404, "task not found"); // row deleted by hand
    console.error("sheet", op, e);
    throw new HttpError(503, DOWN);
  }
}

export type Step =
  | { op: "append"; tab: string; rows: Record<string, string>[] }
  | { op: "update"; tab: string; id: number; patch: Record<string, string>; expect?: Record<string, string> };

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
  const { tabs } = await sheet("read", { tabs: ["Buildings"] });
  return names(tabs.Buildings);
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
