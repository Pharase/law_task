// Google Sheet rows <-> typed tasks and sends (spec "Hand edits: how the app copes"). Pure: no Deno or npm imports.
import { bangkokDate, daysBetween } from "./dates.ts";
import { TAGS } from "./review.ts";
import type { Send } from "./scoring.ts";

export type Row = Record<string, string> & { _row: number };
export type Person = { line_user_id: string; name: string; role: string };
export type Bad = { row: number; tab: string; reason: string };
export type State = "on_process" | "submitted" | "approved" | "cancelled";
export type Outcome = "pending" | "approved" | "void" | "fix";
export type Task = {
  id: number; sheetRow: number; building: string; title: string; details: string | null; tags: string[];
  owner: string; owner_name: string; state: State; due_on: string;
  current_due_on: string; // effective: blank in the sheet means due_on
  fix_round: number; created_by: string; created_at: string; member_notified_at: string | null;
};
export type SendRow = {
  id: number; task_id: number; sent_on: string; sent_at: string; due_on: string | null; outcome: Outcome;
  fix_note: string | null; next_due_on: string | null; reviewed_by: string | null; reviewed_at: string | null;
  member_notified_at: string | null;
};

/** Profiles -> people who may own or be named on tasks. Pending (anyone who opened the link) are left out. */
export function toPeople(profiles: { line_user_id: string; role: string; staff_name?: string | null; display_name?: string | null }[]): Person[] {
  return profiles.filter((p) => ["member", "admin", "revoked"].includes(p.role)).map((p) => ({
    line_user_id: p.line_user_id, role: p.role, name: (p.staff_name || p.display_name || p.line_user_id).trim(),
  }));
}

const STATES: State[] = ["on_process", "submitted", "approved", "cancelled"];
const OUTCOMES: Outcome[] = ["pending", "approved", "void", "fix"];
const cell = (r: Row, k: string) => String(r[k] ?? "").trim();
const orNull = (s: string) => s || null;
const posInt = (s: string) => (/^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null);

/** YYYY-MM-DD (Buddhist-era years > 2400 converted), or null when it isn't a real date. */
export function normDate(v: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]) > 2400 ? Number(m[1]) - 543 : Number(m[1]);
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return d.toISOString().slice(0, 10);
}

/** Valid tasks, bad rows (for admins), and hand reassignments to write back (owner_name changed in the sheet). */
export function parseTasks(rows: Row[], buildings: Set<string>, people: Person[]) {
  const tasks: Task[] = [], bad: Bad[] = [], reassigned: { id: number; owner: string; owner_name: string }[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    const fail = (reason: string) => bad.push({ row: r._row, tab: "Tasks", reason });
    const id = posInt(cell(r, "id"));
    if (!id) { fail("id is missing or not a number"); continue; }
    if (seen.has(id)) { fail(`id ${id} is used twice (copied row?)`); continue; }
    seen.add(id);
    const title = cell(r, "title");
    if (!title) { fail("title is empty"); continue; }
    const building = cell(r, "building");
    if (!buildings.has(building)) { fail(`building "${building}" is not in the Buildings tab`); continue; }
    const tags = cell(r, "tags").split(",").map((t) => t.trim()).filter(Boolean);
    // empty = no score tag: the task counts in คะแนนตรงเวลา only
    if (!tags.every((t) => (TAGS as readonly string[]).includes(t))) { fail("tags must be from the 4 fixed tags (or empty)"); continue; }
    const state = cell(r, "state") as State;
    if (!STATES.includes(state)) { fail(`unknown state "${state}"`); continue; }
    const due_on = normDate(cell(r, "due_on"));
    if (!due_on) { fail("due_on is not a YYYY-MM-DD date"); continue; }
    const cur = cell(r, "current_due_on");
    const current_due_on = cur ? normDate(cur) : due_on;
    if (!current_due_on) { fail("current_due_on is not a YYYY-MM-DD date"); continue; }
    const fr = cell(r, "fix_round");
    const fix_round = fr === "" ? 0 : /^\d+$/.test(fr) ? Number(fr) : null;
    if (fix_round === null) { fail("fix_round is not a whole number"); continue; }

    // Owner: owner_name wins when it names exactly one person (a hand edit = reassignment).
    const owner_name = cell(r, "owner_name");
    const matches = people.filter((p) => p.name.trim() === owner_name);
    if (matches.length !== 1) { fail(`owner_name "${owner_name}" matches ${matches.length ? "more than one person" : "nobody"}`); continue; }
    if (matches[0].role === "admin") { fail(`owner_name "${owner_name}" is an admin; admins can't own tasks`); continue; }
    let owner = cell(r, "owner_id"), member_notified_at = orNull(cell(r, "member_notified_at"));
    if (matches[0].line_user_id !== owner) {
      owner = matches[0].line_user_id;
      member_notified_at = null; // the new owner gets the "new task" notice
      reassigned.push({ id, owner, owner_name });
    }
    tasks.push({
      id, sheetRow: r._row, building, title, details: orNull(cell(r, "details")), tags, owner, owner_name, state,
      due_on, current_due_on, fix_round, created_by: cell(r, "created_by"), created_at: cell(r, "created_at"), member_notified_at,
    });
  }
  return { tasks, bad, reassigned };
}

/** Valid sends of known tasks. A send whose task row was deleted is dropped without a warning. */
export function parseSends(rows: Row[], taskIds: Set<number>) {
  const sends: SendRow[] = [], bad: Bad[] = [];
  for (const r of rows) {
    const fail = (reason: string) => bad.push({ row: r._row, tab: "Sends", reason });
    const id = posInt(cell(r, "id")), task_id = posInt(cell(r, "task_id"));
    if (!id || !task_id) { fail("id or task_id is missing"); continue; }
    if (!taskIds.has(task_id)) continue;
    const outcome = cell(r, "outcome") as Outcome;
    if (!OUTCOMES.includes(outcome)) { fail(`unknown outcome "${outcome}"`); continue; }
    const sent_on = normDate(cell(r, "sent_on"));
    if (!sent_on) { fail("sent_on is not a YYYY-MM-DD date"); continue; }
    const next_due_on = normDate(cell(r, "next_due_on"));
    if (outcome === "fix" && !next_due_on) { fail("a มีปรับแก้ send needs next_due_on"); continue; }
    sends.push({
      id, task_id, sent_on, sent_at: cell(r, "sent_at"), due_on: normDate(cell(r, "due_on")), outcome,
      fix_note: orNull(cell(r, "fix_note")), next_due_on, reviewed_by: orNull(cell(r, "reviewed_by")),
      reviewed_at: orNull(cell(r, "reviewed_at")), member_notified_at: orNull(cell(r, "member_notified_at")),
    });
  }
  return { sends, bad };
}

/** Sends for scoring: round 0 is due on the task's current due_on (hand corrections count); after each มีปรับแก้, its next_due_on. */
export function scoredSends(task: Pick<Task, "due_on">, sends: SendRow[]): Send[] {
  let due = task.due_on;
  return [...sends].sort(sendOrder).map((s) => {
    const out = { sentOn: s.sent_on, dueOn: due, outcome: s.outcome };
    if (s.outcome === "fix" && s.next_due_on) due = s.next_due_on;
    return out;
  });
}

/** Bangkok day of a sheet timestamp (ISO with a time) or date cell (already a day). */
const bkkDay = (s: string) => (/T/.test(s) ? bangkokDate(new Date(s)) : s.slice(0, 10));

/**
 * Team flow at the top of the admin task page: tasks per stage. "This month" = the Bangkok month of `today`:
 * assigned by created_at, approved by the approving review (reviewed_at, else the send date). Cancelled tasks don't count.
 */
export function taskFlow(
  tasks: Pick<Task, "id" | "state" | "owner" | "building" | "created_at" | "current_due_on" | "fix_round">[],
  sends: Pick<SendRow, "id" | "task_id" | "outcome" | "sent_on" | "due_on" | "reviewed_at">[],
  today: string,
) {
  const month = today.slice(0, 7);
  const live = tasks.filter((t) => t.state !== "cancelled");
  const mine = (id: number, outcome: string) => sends.filter((s) => s.task_id === id && s.outcome === outcome).sort((a, b) => a.id - b.id).at(-1);
  const assigned = live.filter((t) => bkkDay(String(t.created_at)).slice(0, 7) === month);
  const doing = live.filter((t) => t.state === "on_process");
  const waiting = live.filter((t) => t.state === "submitted");
  const approved = live.filter((t) => t.state === "approved").map((t) => mine(t.id, "approved"))
    .filter((s) => s && bkkDay(String(s.reviewed_at || s.sent_on)).slice(0, 7) === month);
  return {
    month,
    assigned: assigned.length,
    people: new Set(assigned.map((t) => t.owner)).size,
    buildings: new Set(assigned.map((t) => t.building)).size,
    doing: doing.length,
    overdue: doing.filter((t) => t.current_due_on < today).length,
    fixing: doing.filter((t) => t.fix_round > 0).length,
    waiting: waiting.length,
    longestWait: Math.max(0, ...waiting.map((t) => daysBetween(mine(t.id, "pending")?.sent_on ?? today, today))),
    approved: approved.length,
    approvedLate: approved.filter((s) => s!.due_on && s!.sent_on > s!.due_on).length,
  };
}

/** History order: by sent date, then id, so a line an admin adds later for an earlier day sorts into place. */
export const sendOrder = (a: Pick<SendRow, "sent_on" | "id">, b: Pick<SendRow, "sent_on" | "id">) =>
  a.sent_on.localeCompare(b.sent_on) || a.id - b.id;

/**
 * One history line as an admin typed it (adding or correcting old records): sent date never after today, a known outcome,
 * and a มีปรับแก้ needs its new due date. Returns the Sends cells; throws a message an admin can read.
 */
export function sendLine(input: { sent_on?: unknown; outcome?: unknown; fix_note?: unknown; next_due_on?: unknown }, today: string) {
  const sent_on = normDate(String(input.sent_on ?? ""));
  if (!sent_on || sent_on > today) throw new Error("วันที่ส่งต้องเป็นวันที่ และไม่เกินวันนี้ · sent date can't be in the future");
  const outcome = String(input.outcome ?? "") as Outcome;
  if (!OUTCOMES.includes(outcome)) throw new Error("เลือกผลการตรวจ · pick an outcome");
  const next = outcome === "fix" ? normDate(String(input.next_due_on ?? "")) : null;
  if (outcome === "fix" && !next) throw new Error("มีปรับแก้ ต้องมีกำหนดส่งแก้ · next due date is required");
  return { sent_on, outcome, fix_note: outcome === "pending" ? "" : String(input.fix_note ?? "").trim().slice(0, 2000), next_due_on: next ?? "" };
}

/**
 * The task's status after an admin changed its history, as if every line had been reviewed in order: the last line
 * decides (รอตรวจ -> submitted, อนุมัติ -> approved, else on process); fix_round counts มีปรับแก้ and the last one's
 * new due date is the current one ("" = the original). Only the last line may still be รอตรวจ.
 */
export function taskFromSends(sends: Pick<SendRow, "id" | "sent_on" | "outcome" | "next_due_on">[]) {
  const list = [...sends].sort(sendOrder);
  if (list.slice(0, -1).some((s) => s.outcome === "pending")) throw new Error("รอตรวจ ได้เฉพาะบรรทัดล่าสุด · only the latest line can be pending");
  const last = list.at(-1)?.outcome;
  const fixes = list.filter((s) => s.outcome === "fix");
  return {
    state: (last === "pending" ? "submitted" : last === "approved" ? "approved" : "on_process") as State,
    fix_round: fixes.length,
    current_due_on: fixes.at(-1)?.next_due_on ?? "",
  };
}

const TASK_COLS = ["building", "title", "details", "tags", "owner_name", "state", "due_on", "current_due_on", "fix_round",
  "created_by", "created_at", "member_notified_at"];

/** Task fields -> sheet cells (strings). Only the keys given; `owner` is the owner_id column. */
export function taskCells(t: Partial<Task>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const col = k === "owner" ? "owner_id" : k;
    if (col !== "owner_id" && !TASK_COLS.includes(col)) continue;
    out[col] = Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v);
  }
  return out;
}

export class SheetDown extends Error {}

/** The script's reply as an object; anything else (HTML login page, {error}, non-200) throws SheetDown. */
export function parseReply(status: number, text: string): Record<string, unknown> {
  if (status !== 200) throw new SheetDown(`status ${status}`);
  let body;
  try { body = JSON.parse(text); } catch { throw new SheetDown("reply is not JSON"); }
  if (!body || typeof body !== "object") throw new SheetDown("reply is not an object");
  if (body.error) throw new SheetDown(String(body.error));
  return body;
}

/** Why the sheet call failed, as something an admin can fix. Never includes the secret or the URL. */
export function sheetDownHint(reason: string): string {
  if (reason === "forbidden") return "secret mismatch: the API secret (ตั้งค่า → การเชื่อมต่อ Google Sheet, or Supabase GSHEET_SECRET) must equal the script's API_SECRET";
  if (reason === "reply is not JSON") return "the script answered with a web page: in the Apps Script editor run setup once (grants permission), and check the deployment is Web app · Anyone";
  if (/^status 40[134]/.test(reason)) return "the script URL (ตั้งค่า → การเชื่อมต่อ Google Sheet, or Supabase GSHEET_URL) is wrong or the deployment was removed: copy the /exec URL again";
  if (/not set/.test(reason)) return reason;
  if (/abort|timeout/i.test(reason)) return "Google took over 10 seconds; try again";
  return reason.slice(0, 200); // the script's own message, e.g. "tab Invoices is missing; run setup"
}

/** Identity of one assigned task, for spotting a double submit. */
export const taskKey = (owner: string, building: string, title: string, due: string) => [owner, building, title.trim(), due].join("|");

/** Tasks this admin created in the last `windowMs` (not cancelled): a repeat of one of these is a double submit. */
export function recentTaskKeys(tasks: Pick<Task, "owner" | "building" | "title" | "due_on" | "created_by" | "created_at" | "state">[],
  adminId: string, nowMs: number, windowMs = 120_000): Set<string> {
  return new Set(tasks
    .filter((t) => t.created_by === adminId && t.state !== "cancelled" && nowMs - Date.parse(t.created_at) <= windowMs)
    .map((t) => taskKey(t.owner, t.building, t.title, t.due_on)));
}

/**
 * Which tabs an Apps Script op writes, so their cached copies can be dropped: a list, null = every tab,
 * undefined = the op writes no sheet tab (reads, Drive files).
 */
// deno-lint-ignore no-explicit-any
export function writtenTabs(op: string, p: Record<string, any>): string[] | null | undefined {
  switch (op) {
    case "append": case "update": case "deleteRows": return p.tab ? [String(p.tab)] : null;
    case "batch": return [...new Set(((p.steps ?? []) as { tab?: string }[]).map((s) => String(s.tab ?? "")))].filter(Boolean);
    case "replaceMembers": return ["Members"];
    case "setup": return null;
  }
  return undefined;
}
