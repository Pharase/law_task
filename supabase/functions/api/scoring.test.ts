// Worked examples from the spec ("Performance"), dates in Jan 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memberScores, scale, taskScore, type Send } from "./scoring.ts";

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

test("memberScores skips tasks that aren't approved", () => {
  const m = memberScores([{ owner: "U1", tags: ["การประสานงาน"], sends: [s("2026-01-08", "2026-01-10", "pending")] }]);
  assert.deepEqual(m, {});
});
