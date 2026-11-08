import { test } from "node:test";
import assert from "node:assert/strict";
import { bangkokDate, daysBetween, periodRange } from "./dates.ts";

test("00:30 Bangkok is still that Bangkok day", () =>
  assert.equal(bangkokDate(new Date("2026-03-01T17:30:00Z")), "2026-03-02"));

test("daysBetween counts whole days, negative when earlier", () => {
  assert.equal(daysBetween("2026-01-10", "2026-01-14"), 4);
  assert.equal(daysBetween("2026-01-10", "2026-01-08"), -2);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
});

test("periodRange", () => {
  assert.deepEqual(periodRange("month", 2026, 2), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange("month", 2028, 2), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(periodRange("quarter", 2026, 4), { from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(periodRange("quarter", 2026, 1), { from: "2026-01-01", to: "2026-03-31" });
});
