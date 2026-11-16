import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeSettings, readSettings } from "./settings.ts";
import { isWorkingHours, shouldRunDigest } from "./digest.ts";

test("partial edit keeps the rest; days deduped and sorted", () => {
  const s = normalizeSettings({ digest: { time: "07:30", days: [5, 1, 1] } });
  assert.deepEqual(s.digest, { on: true, time: "07:30", days: [1, 5] });
  assert.deepEqual(s.instant, DEFAULT_SETTINGS.instant);
});

test("bad input is refused", () => {
  assert.throws(() => normalizeSettings({ digest: { time: "25:00" } }));
  assert.throws(() => normalizeSettings({ instant: { start: "18:00", end: "09:00" } }));
  assert.throws(() => normalizeSettings({ instant: { days: [7] } }));
  assert.throws(() => normalizeSettings({ taskHero: "http://x/y.jpg" }));
});

test("unreadable stored row falls back to defaults", () => {
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings({ digest: { time: "nope" } }), DEFAULT_SETTINGS);
});

test("custom window: days, start/end, and the off switch", () => {
  const w = { on: true, start: "07:00", end: "12:00", days: [1] };
  assert.equal(isWorkingHours(new Date("2026-11-09T00:00:00Z"), w), true);  // Mon 07:00
  assert.equal(isWorkingHours(new Date("2026-11-09T05:00:00Z"), w), false); // Mon 12:00
  assert.equal(isWorkingHours(new Date("2026-11-10T01:00:00Z"), w), false); // Tue
  assert.equal(isWorkingHours(new Date("2026-11-09T01:00:00Z"), { ...w, on: false }), false);
});

test("custom digest: Saturday 13:30 once, off switch stops it", () => {
  const d = { on: true, time: "13:30", days: [6] };
  assert.equal(shouldRunDigest(new Date("2026-03-07T06:29:00Z"), null, d), false); // Sat 13:29
  assert.equal(shouldRunDigest(new Date("2026-03-07T06:35:00Z"), null, d), true);  // Sat 13:35
  assert.equal(shouldRunDigest(new Date("2026-03-07T06:35:00Z"), "2026-03-07", d), false);
  assert.equal(shouldRunDigest(new Date("2026-03-07T06:35:00Z"), null, { ...d, on: false }), false);
});
