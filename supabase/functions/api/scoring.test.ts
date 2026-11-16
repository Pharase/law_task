// Worked examples from the spec ("Performance"), dates in Jan 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memberScores, performanceRows, scale, taskScore, type Send } from "./scoring.ts";

const s = (sentOn: string, dueOn: string, outcome: Send["outcome"]): Send => ({ sentOn, dueOn, outcome });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);

test("early", () =>
  assert.deepEqual(taskScore([s("2026-01-08", "2026-01-10", "approved")]), { onTime: 10, accuracy: 10, task: 10 }));

test("4 days late", () => near(taskScore([s("2026-01-14", "2026-01-10", "approved")])!.task, 8.6667));

test("40 days late floors at 0", () =>
  assert.equal(taskScore([s("2026-02-19", "2026-01-10", "approved")])!.task, 0));

test("one fix round", () =>
  assert.deepEqual(
    taskScore([s("2026-01-10", "2026-01-10", "fix"), s("2026-01-18", "2026-01-15", "approved")]),
    { onTime: 9, accuracy: 9.5, task: 9.25 },
  ));

test("void send ignored", () =>
  near(taskScore([s("2026-01-09", "2026-01-10", "void"), s("2026-01-12", "2026-01-10", "approved")])!.task, 9.3333));

test("not approved -> null", () =>
  assert.equal(taskScore([s("2026-01-09", "2026-01-10", "pending")]), null));

test("scale min-max, single/equal -> 5", () => {
  const r = scale({ a: 0.5, b: 1.0, c: 0.9333 });
  assert.equal(r.a, 1);
  assert.equal(r.b, 5);
  near(r.c, 4.4667);
  assert.deepEqual(scale({ a: 0.7 }), { a: 5 });
  assert.deepEqual(scale({ a: 0.7, b: 0.7 }), { a: 5, b: 5 });
});

test("memberScores averages task scores / 10 and per tag", () => {
  const m = memberScores([
    { owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08", "2026-01-10", "approved")] },
    { owner: "U1", tags: ["ความถูกต้อง"], sends: [s("2026-01-14", "2026-01-10", "approved")] },
  ]);
  near(m.U1.overall, 0.9778); // ตรงเวลา 0.9333, การประสานงาน 1, ความถูกต้อง 1 (late, but never sent back)
  assert.equal(m.U1.byTag["การประสานงาน"], 1);
  assert.equal(m.U1.byTag["ความถูกต้อง"], 1);
  assert.equal(m.U1.tasks, 2);
});

test("performanceRows scales overall and each tag across members", () => {
  const rows = performanceRows([
    { owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08", "2026-01-10", "approved")] },
    { owner: "U2", tags: ["การประสานงาน"], sends: [s("2026-01-14", "2026-01-10", "approved")] },
  ], { U1: "Ann", U2: "Bee" });
  const u1 = rows.find((r) => r.line_user_id === "U1")!;
  const u2 = rows.find((r) => r.line_user_id === "U2")!;
  assert.equal(u1.name, "Ann");
  assert.equal(u1.overall5, 5);
  assert.equal(u2.overall5, 1);
  assert.deepEqual(u1.byTag["การประสานงาน"], { raw: 1, scaled: 5 });
  assert.equal(u2.byTag["การประสานงาน"].scaled, 1);
  assert.equal(u1.tasks, 1);
});

test("memberScores skips tasks that aren't approved", () => {
  const m = memberScores([{ owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08", "2026-01-10", "pending")] }]);
  assert.deepEqual(m, {});
});

test("performance rows: admins see everyone, anyone else only their own row", async () => {
  const { visibleRows } = await import("./scoring.ts");
  const rows = [{ line_user_id: "U1", name: "a" }, { line_user_id: "U2", name: "b" }];
  assert.deepEqual(visibleRows(rows, { line_user_id: "UA", role: "admin" }).map((r) => r.line_user_id), ["U1", "U2"]);
  assert.deepEqual(visibleRows(rows, { line_user_id: "U2", role: "member" }).map((r) => r.line_user_id), ["U2"]);
  assert.deepEqual(visibleRows(rows, { line_user_id: "U9", role: "member" }), []);
  assert.deepEqual(visibleRows(rows, { line_user_id: "U1", role: "revoked" }).map((r) => r.line_user_id), ["U1"]);
});

test("คะแนนตรงเวลา is averaged per member (each / 10) and scaled 1-5 like the overall", () => {
  const rows = performanceRows([
    // U1: sent on time, approved first try -> onTime 10, accuracy 10
    { owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08", "2026-01-10", "approved")] },
    // U2: one fix round sent 3 days late (9), then approved 6 days late against the new due (8)
    { owner: "U2", tags: ["การประสานงาน"], sends: [s("2026-01-13", "2026-01-10", "fix"), s("2026-01-26", "2026-01-20", "approved")] },
  ], { U1: "A", U2: "B" });
  const u1 = rows.find((r) => r.line_user_id === "U1")!, u2 = rows.find((r) => r.line_user_id === "U2")!;
  assert.equal(u1.onTime, 1);
  assert.equal(u2.onTime, 0.8);    // last send 6 days after the latest due date -> 10 - 2
  assert.equal(u1.onTime5, 5);
  assert.equal(u2.onTime5, 1);
});

test("overall = mean of คะแนนตรงเวลา and each tag score the member has work in", () => {
  const m = memberScores([
    { owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08", "2026-01-10", "approved")] }, // 10
    { owner: "U1", tags: ["ความถูกต้อง", "การประสานงาน"], sends: [s("2026-01-14", "2026-01-10", "approved")] }, // 4 days late: 8.667
  ]);
  near(m.U1.onTime, 0.9333);
  near(m.U1.byTag["การประสานงาน"], 0.9333);
  near(m.U1.byTag["ความถูกต้อง"], 1); // late, but never sent back for fixes
  near(m.U1.overall, 0.9556); // (0.9333 + 0.9333 + 1) / 3
});

test("periodCount: approval month counts in full; unapproved overdue tasks count late in every period until approved", async () => {
  const { periodCount } = await import("./scoring.ts");
  const t = { state: "on_process", createdOn: "2001-01-01", currentDue: "2001-01-10", approvedOn: null, sends: [] as Send[] };
  const today = "2001-12-31";
  near((periodCount(t, "2001-01-01", "2001-01-31", today) as { lateOnly: number }).lateOnly, 3); // overdue in its own month: 21 days late
  assert.equal(periodCount(t, "2001-01-01", "2001-01-31", "2001-01-09"), null); // not due yet: not counted
  assert.equal(periodCount({ ...t, createdOn: "2001-02-03" }, "2001-01-01", "2001-01-31", today), null); // assigned after the period
  near((periodCount(t, "2001-02-01", "2001-02-28", today) as { lateOnly: number }).lateOnly, 0); // 49 days late as of 28 Feb
  const done = { ...t, state: "approved", approvedOn: "2001-03-01", sends: [s("2001-03-01", "2001-01-10", "approved")] };
  assert.equal(periodCount(done, "2001-03-01", "2001-03-31", today), "full");  // approved in March: full, late by dates
  assert.equal(periodCount(done, "2001-01-01", "2001-03-31", today), "full");  // quarter 1: counted normally
  assert.equal(periodCount(done, "2001-04-01", "2001-04-30", today), null);    // approved earlier
  // sent on time, waiting for review across the month end: not late, not counted
  const waiting = { ...t, createdOn: "2001-01-25", currentDue: "2001-02-15", sends: [s("2001-02-10", "2001-02-15", "pending")] };
  assert.equal(periodCount(waiting, "2001-02-01", "2001-02-28", today), null);
  // sent 3 days late, not approved yet: late only
  const lateSent = { ...waiting, sends: [s("2001-02-18", "2001-02-15", "pending")] };
  assert.equal((periodCount(lateSent, "2001-02-01", "2001-02-28", today) as { lateOnly: number }).lateOnly, 9);
});

test("lateOnly tasks feed คะแนนตรงเวลา but no tag score", () => {
  const m = memberScores([
    { owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08", "2026-01-10", "approved")] },
    { owner: "U1", tags: ["ความถูกต้อง"], sends: [], lateOnly: 4 },
  ]).U1;
  near(m.onTime, 0.7);
  assert.deepEqual(Object.keys(m.byTag), ["การประสานงาน"]);
  assert.equal(m.tasks, 1); // งาน = approved tasks only
});

test("ความถูกต้อง: 10 with no fix round, −2 per มีปรับแก้, กดผิด ignored, floor 0", async () => {
  const { fixScore } = await import("./scoring.ts");
  assert.equal(fixScore([s("2026-01-20", "2026-01-10", "approved")]), 10);
  assert.equal(fixScore([s("2026-01-09", "2026-01-10", "fix"), s("2026-01-09", "2026-01-10", "void"), s("2026-01-12", "2026-01-15", "approved")]), 8);
  assert.equal(fixScore(Array.from({ length: 6 }, () => s("2026-01-09", "2026-01-10", "fix"))), 0);
  const m = memberScores([{ owner: "U1", tags: ["ความถูกต้อง", "การประสานงาน"],
    sends: [s("2026-01-10", "2026-01-10", "fix"), s("2026-01-18", "2026-01-15", "approved")] }]).U1;
  near(m.byTag["ความถูกต้อง"], 0.8);   // one fix round
  near(m.byTag["การประสานงาน"], 0.925); // unchanged: on time + every round
});
