import { test } from "node:test";
import assert from "node:assert/strict";
import { newsCells, parseNews } from "./news.ts";

const row = (id: number, created_at: string, over: Record<string, string> = {}) => ({
  _row: id + 1, id: String(id), title: "ข่าว " + id, body: "", pinned: "", created_by: "UA", created_at, deleted_at: "", ...over,
});

test("pinned first, then newest to oldest; deleted and broken rows are left out", () => {
  const items = parseNews([
    row(1, "2026-11-01T01:00:00Z"),
    row(2, "2026-11-05T01:00:00Z"),
    row(3, "2026-10-20T01:00:00Z", { pinned: "1" }),
    row(4, "2026-11-06T01:00:00Z", { deleted_at: "2026-11-07T01:00:00Z" }),
    row(5, "2026-11-07T01:00:00Z", { title: " " }),
    row(6, "2026-11-04T01:00:00Z", { pinned: "TRUE" }),
  ]);
  assert.deepEqual(items.map((n) => n.id), [6, 3, 2, 1]);
  assert.deepEqual(items.map((n) => n.pinned), [true, true, false, false]);
});

test("body blank -> null; created_at kept", () => {
  const [n] = parseNews([row(1, "2026-11-01T01:00:00Z")]);
  assert.equal(n.body, null);
  assert.equal(n.created_at, "2026-11-01T01:00:00Z");
});

test("newsCells trims and pins", () =>
  assert.deepEqual(newsCells({ title: "  ประชุม  ", body: " วันศุกร์ ", pinned: true }), { title: "ประชุม", body: "วันศุกร์", pinned: "1" }));

test("newsCells: unpinned is blank", () => assert.equal(newsCells({ title: "x" }).pinned, ""));

test("newsCells rejects an empty title and an over-long body", () => {
  assert.throws(() => newsCells({ title: " " }), /title|หัวข้อ/);
  assert.throws(() => newsCells({ title: "x", body: "a".repeat(3001) }), /3000/);
});
