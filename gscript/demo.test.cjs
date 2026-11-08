const { test } = require("node:test");
const assert = require("node:assert/strict");
const { demoPlan } = require("./Demo.js");

const members = [{ line_user_id: "U1", name: "ทีมนุ่น" }, { line_user_id: "U2", name: "ทีมมิน" }, { line_user_id: "U3", name: "ทีมบี" }];
const today = "2026-11-09";
const plan = demoPlan(today, members, "2026-11-09T03:00:00.000Z");

test("demo buildings: two per member (owner set), one unassigned, all named DEMO", () => {
  assert.equal(plan.buildings.length, members.length * 2 + 1);
  assert.ok(plan.buildings.every((b) => b.name.startsWith("DEMO ")));
  assert.equal(plan.buildings.filter((b) => !b.owner).length, 1);
});

test("every task is demo-marked, already notified, and on a building its owner looks after", () => {
  for (const t of plan.tasks) {
    assert.equal(t.cells.created_by, "demo");
    assert.ok(t.cells.title.startsWith("[DEMO]"));
    assert.ok(t.cells.member_notified_at);
    const b = plan.buildings.find((x) => x.name === t.cells.building);
    assert.equal(b.owner, t.cells.owner_name);
  }
});

test("all states are covered: to do, overdue, fix, waiting review, on time, late, cancelled", () => {
  const kinds = new Set(plan.tasks.map((t) => t.kind));
  for (const k of ["todo", "overdue", "fix", "review", "ontime", "late", "cancelled"]) assert.ok(kinds.has(k), k);
});

test("dates are real: nothing sent or created in the future; late sends are after their due date", () => {
  for (const t of plan.tasks) {
    assert.ok(t.cells.created_at.slice(0, 10) <= today);
    for (const s of t.sends) assert.ok(s.sent_on <= today, `${t.kind} sent ${s.sent_on}`);
    if (t.kind === "late") assert.ok(t.sends[0].sent_on > t.cells.due_on);
    if (t.kind === "ontime") assert.ok(t.sends[0].sent_on <= t.cells.due_on);
    if (t.kind === "overdue") assert.ok(t.cells.due_on < today);
    if (t.kind === "fix") { assert.equal(t.cells.fix_round, "1"); assert.equal(t.sends[0].outcome, "fix"); }
  }
});

test("invoices cover all 4 statuses with matching dates; news has one pinned", () => {
  assert.deepEqual([...new Set(plan.invoices.map((i) => i.status))].sort(), ["รอทนายวางบิล", "รอนิติชำระเงิน", "รอทนายส่งใบเสร็จ", "เสร็จสิ้น"].sort());
  for (const i of plan.invoices) {
    if (i.status === "เสร็จสิ้น") assert.ok(i.billed_on && i.transfer_on && i.receipt_on);
    assert.equal(i.created_by, "demo");
  }
  assert.equal(plan.news.filter((n) => n.pinned === "1").length, 1);
  assert.ok(plan.news.every((n) => n.created_by === "demo"));
});

test("no members -> no tasks (tasks can't be given to admins), buildings and the rest still come", () => {
  const empty = demoPlan(today, [], "2026-11-09T03:00:00.000Z");
  assert.equal(empty.tasks.length, 0);
  assert.equal(empty.buildings.length, 1);
  assert.ok(empty.invoices.length > 0);
});
