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
  near(m.U1.overall, 0.9333);
  assert.equal(m.U1.byTag["การประสานงาน"], 1);
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

test("on-time and accuracy are averaged per member (each / 10) and scaled 1-5 like the overall", () => {
  const rows = performanceRows([
    // U1: sent on time, approved first try -> onTime 10, accuracy 10
    { owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08", "2026-01-10", "approved")] },
    // U2: one fix round sent 3 days late (9), then approved 6 days late against the new due (8)
    { owner: "U2", tags: ["การประสานงาน"], sends: [s("2026-01-13", "2026-01-10", "fix"), s("2026-01-26", "2026-01-20", "approved")] },
  ], { U1: "A", U2: "B" });
  const u1 = rows.find((r) => r.line_user_id === "U1")!, u2 = rows.find((r) => r.line_user_id === "U2")!;
  assert.equal(u1.onTime, 1);
  assert.equal(u1.accuracy, 1);
  assert.equal(u2.onTime, 0.8);    // last send 6 days after the latest due date -> 10 - 2
  assert.equal(u2.accuracy, 0.85); // mean(9, 8) / 10
  assert.equal(u1.onTime5, 5);
  assert.equal(u2.onTime5, 1);
});
