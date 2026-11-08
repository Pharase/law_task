import { test } from "node:test";
import assert from "node:assert/strict";
import { normDate, parseReply, parseSends, parseTasks, scoredSends, SheetDown, taskCells, toPeople, type Task } from "./sheetRows.ts";

const people = [
  { line_user_id: "U1", name: "Ann", role: "member" },
  { line_user_id: "U2", name: "Bob", role: "member" },
  { line_user_id: "U3", name: "Boss", role: "admin" },
  { line_user_id: "U4", name: "Gone", role: "revoked" },
  { line_user_id: "U5", name: "Twin", role: "member" },
  { line_user_id: "U6", name: "Twin", role: "member" },
];
const buildings = new Set(["B1"]);
const row = (over: Record<string, string> = {}) => ({
  _row: 2, id: "1", building: "B1", title: "T", details: "", tags: "การประสานงาน, ความถูกต้อง", owner_id: "U1",
  owner_name: "Ann", state: "on_process", due_on: "2026-11-20", current_due_on: "", fix_round: "", created_by: "U3",
  created_at: "2026-11-08T01:00:00Z", member_notified_at: "2026-11-09T02:00:00Z", ...over,
});
const parse = (over: Record<string, string> = {}) => parseTasks([row(over)], buildings, people);

test("normDate keeps ISO, converts Buddhist years, rejects other formats", () => {
  assert.equal(normDate("2026-11-20"), "2026-11-20");
  assert.equal(normDate("2569-11-20"), "2026-11-20");
  assert.equal(normDate("2026-2-3"), "2026-02-03");
  assert.equal(normDate("20/11/2026"), null);
  assert.equal(normDate("2026-02-30"), null);
  assert.equal(normDate(""), null);
});

test("a good row parses; blank current_due_on falls back to due_on, blank fix_round is 0", () => {
  const { tasks, bad, reassigned } = parse();
  assert.deepEqual(bad, []);
  assert.deepEqual(reassigned, []);
  assert.equal(tasks[0].id, 1);
  assert.equal(tasks[0].sheetRow, 2);
  assert.equal(tasks[0].current_due_on, "2026-11-20");
  assert.equal(tasks[0].fix_round, 0);
  assert.equal(tasks[0].details, null);
  assert.deepEqual(tasks[0].tags, ["การประสานงาน", "ความถูกต้อง"]);
  assert.equal(tasks[0].owner, "U1");
});

for (const [name, over] of [
  ["missing title", { title: " " }],
  ["bad due date", { due_on: "tomorrow" }],
  ["bad current_due_on", { current_due_on: "x" }],
  ["unknown state", { state: "done" }],
  ["unknown tag", { tags: "อื่นๆ" }],
  ["no tag", { tags: "" }],
  ["unknown building", { building: "Nowhere" }],
  ["bad id", { id: "abc" }],
  ["bad fix_round", { fix_round: "-1" }],
] as const) {
  test(`bad row is reported with its sheet row and left out: ${name}`, () => {
    const { tasks, bad } = parse(over);
    assert.equal(tasks.length, 0);
    assert.equal(bad.length, 1);
    assert.equal(bad[0].row, 2);
    assert.equal(bad[0].tab, "Tasks");
  });
}

test("owner_name changed by hand to another member -> reassigned, new-task notice re-armed", () => {
  const { tasks, bad, reassigned } = parse({ owner_name: "Bob" });
  assert.deepEqual(bad, []);
  assert.equal(tasks[0].owner, "U2");
  assert.equal(tasks[0].member_notified_at, null);
  assert.deepEqual(reassigned, [{ id: 1, owner: "U2", owner_name: "Bob" }]);
});

for (const [name, owner_name] of [["nobody", "Zed"], ["two people", "Twin"], ["an admin", "Boss"]]) {
  test(`owner_name matching ${name} -> flagged, not applied`, () => {
    const { tasks, bad, reassigned } = parse({ owner_name });
    assert.equal(tasks.length, 0);
    assert.equal(bad.length, 1);
    assert.deepEqual(reassigned, []);
  });
}

test("a copied row (duplicate id) is flagged; the first row stays", () => {
  const { tasks, bad } = parseTasks([row(), row({ _row: 3 } as never)], buildings, people);
  assert.deepEqual(tasks.map((t) => t.sheetRow), [2]);
  assert.deepEqual(bad.map((b) => b.row), [3]);
});

test("a revoked person's task stays valid", () => {
  const { tasks, bad } = parse({ owner_id: "U4", owner_name: "Gone" });
  assert.deepEqual(bad, []);
  assert.equal(tasks[0].owner, "U4");
});

const send = (over: Record<string, string> = {}) => ({
  _row: 2, id: "1", task_id: "1", sent_on: "2026-11-21", sent_at: "2026-11-21T03:00:00Z", due_on: "2026-11-20",
  outcome: "pending", fix_note: "", next_due_on: "", reviewed_by: "", reviewed_at: "", member_notified_at: "", ...over,
});

test("parseSends: send of a deleted task is dropped silently; unknown outcome is reported", () => {
  const { sends, bad } = parseSends([send(), send({ _row: 3, id: "2", task_id: "9" }), send({ _row: 4, id: "3", outcome: "maybe" })], new Set([1]));
  assert.deepEqual(sends.map((s) => s.id), [1]);
  assert.deepEqual(bad.map((b) => [b.tab, b.row]), [["Sends", 4]]);
  assert.equal(sends[0].fix_note, null);
});

test("parseSends: a fix without a next due date is reported", () =>
  assert.equal(parseSends([send({ outcome: "fix" })], new Set([1])).bad.length, 1));

test("scoredSends: round 0 uses the task's current due_on, later rounds the fix's next_due_on, void keeps its round", () => {
  const task = { due_on: "2026-11-25" } as Task; // hand-corrected after the first send copied 2026-11-20
  const { sends } = parseSends([
    send({ id: "1", outcome: "void" }),
    send({ id: "2", outcome: "fix", next_due_on: "2026-11-30" }),
    send({ id: "3", outcome: "void", sent_on: "2026-11-29" }),
    send({ id: "4", outcome: "approved", sent_on: "2026-11-29" }),
  ], new Set([1]));
  assert.deepEqual(scoredSends(task, sends).map((s) => [s.dueOn, s.outcome]), [
    ["2026-11-25", "void"], ["2026-11-25", "fix"], ["2026-11-30", "void"], ["2026-11-30", "approved"],
  ]);
});

test("toPeople: only real logins (pending strangers can't shadow a staff name); staff_name wins", () =>
  assert.deepEqual(toPeople([
    { line_user_id: "U1", role: "member", staff_name: "Ann ", display_name: "ann_line" },
    { line_user_id: "U7", role: "pending", staff_name: null, display_name: "Ann" },
    { line_user_id: "U4", role: "revoked", staff_name: null, display_name: "Gone" },
  ]), [
    { line_user_id: "U1", role: "member", name: "Ann" },
    { line_user_id: "U4", role: "revoked", name: "Gone" },
  ]));

test("taskCells: tags joined, owner -> owner_id, null -> empty, only given keys", () =>
  assert.deepEqual(taskCells({ tags: ["a", "b"], owner: "U1", details: null, fix_round: 2 }),
    { tags: "a, b", owner_id: "U1", details: "", fix_round: "2" }));

test("parseReply: HTML, {error} and non-200 throw SheetDown; JSON object is returned", () => {
  assert.throws(() => parseReply(200, "<html>Sign in</html>"), SheetDown);
  assert.throws(() => parseReply(200, '{"error":"forbidden"}'), SheetDown);
  assert.throws(() => parseReply(500, "{}"), SheetDown);
  assert.deepEqual(parseReply(200, '{"rows":[]}'), { rows: [] });
});

test("sheetDownHint turns the failure into what to fix (no secrets in it)", async () => {
  const { sheetDownHint } = await import("./sheetRows.ts");
  assert.match(sheetDownHint("forbidden"), /GSHEET_SECRET.*API_SECRET/);
  assert.match(sheetDownHint("reply is not JSON"), /setup/);
  assert.match(sheetDownHint("status 404"), /GSHEET_URL/);
  assert.match(sheetDownHint("GSHEET_URL / GSHEET_SECRET not set"), /not set/);
  assert.match(sheetDownHint("The operation was aborted due to timeout"), /10/);
  assert.match(sheetDownHint("tab Invoices is missing; run setup"), /tab Invoices is missing/);
});

test("recentTaskKeys: same admin, same owner/building/title/due within 2 minutes, not cancelled", async () => {
  const { recentTaskKeys, taskKey } = await import("./sheetRows.ts");
  const now = Date.parse("2026-11-09T03:00:00Z");
  const t = (over: Record<string, unknown>) => ({ owner: "U1", building: "KL2", title: "ตรวจสัญญา", due_on: "2026-11-20", created_by: "UA", created_at: "2026-11-09T02:59:30Z", state: "on_process", ...over });
  const keys = recentTaskKeys([
    t({}),                                                   // 30 s ago -> duplicate
    t({ building: "KL3", created_at: "2026-11-09T02:57:00Z" }), // 3 min ago -> too old
    t({ building: "Mono1", created_by: "UB" }),               // another admin -> not counted
    t({ building: "SD7", state: "cancelled" }),               // cancelled -> not counted
  ] as never, "UA", now);
  assert.deepEqual([...keys], [taskKey("U1", "KL2", "ตรวจสัญญา", "2026-11-20")]);
});
