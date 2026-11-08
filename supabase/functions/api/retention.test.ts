import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeletable, isDue } from "./retention.ts";

const now = new Date("2027-06-01T00:00:00Z");
const f = (created_at: string, backed_up_at: string | null, deleted_at: string | null = null) => ({ created_at, backed_up_at, deleted_at });

test("young file never deletable", () =>
  assert.equal(isDeletable(f("2027-01-01T00:00:00Z", "2027-05-01T00:00:00Z"), now), false));

test("old but not backed up -> keep", () =>
  assert.equal(isDeletable(f("2026-01-01T00:00:00Z", null), now), false));

test("old and backed up -> delete", () =>
  assert.equal(isDeletable(f("2026-01-01T00:00:00Z", "2027-05-01T00:00:00Z"), now), true));

test("backed up less than 7 days ago -> keep (recovery window if the ZIP never saved)", () =>
  assert.equal(isDeletable(f("2026-01-01T00:00:00Z", "2027-05-28T00:00:00Z"), now), false));

test("backed up more than 7 days ago -> delete", () =>
  assert.equal(isDeletable(f("2026-01-01T00:00:00Z", "2027-05-24T00:00:00Z"), now), true));

test("already deleted -> no", () =>
  assert.equal(isDeletable(f("2026-01-01T00:00:00Z", "2027-05-01T00:00:00Z", "2027-05-02T00:00:00Z"), now), false));

test("due = older than 365 days and not deleted", () => {
  assert.equal(isDue(f("2026-05-31T00:00:00Z", null), now), true);
  assert.equal(isDue(f("2026-06-02T00:00:00Z", null), now), false);
  assert.equal(isDue(f("2026-01-01T00:00:00Z", null, "2027-01-01T00:00:00Z"), now), false);
});
