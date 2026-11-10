const { test } = require("node:test");
const assert = require("node:assert/strict");
const { HEADERS, normCell, toObjects, planBatch, rowsToDelete } = require("./rows.js");

const counter = () => { const n = { Tasks: 5, Sends: 1 }; return (tab) => n[tab]++; };
const tables = () => ({
  Tasks: { headers: HEADERS.Tasks, rows: [{ ...blank("Tasks"), id: "4", state: "on_process", _row: 2 }] },
  Sends: { headers: HEADERS.Sends, rows: [] },
  Buildings: { headers: HEADERS.Buildings, rows: [{ name: "B1", _row: 2 }] },
});
const blank = (tab) => Object.fromEntries(HEADERS[tab].map((h) => [h, ""]));

test("normCell: Date -> YYYY-MM-DD, numbers -> string, null -> empty", () => {
  assert.equal(normCell(new Date(2026, 10, 20)), "2026-11-20");
  assert.equal(normCell(3), "3");
  assert.equal(normCell(null), "");
});

test("toObjects keys by header, adds the sheet row, skips blank rows", () =>
  assert.deepEqual(toObjects([["id", "title"], [1, "A"], ["", ""]]), [{ id: "1", title: "A", _row: 2 }]));

test("update with matching expect applies the patch", () => {
  const r = planBatch([{ op: "update", tab: "Tasks", id: 4, patch: { state: "submitted" }, expect: { state: "on_process" } }], tables(), counter());
  assert.equal(r.writes.length, 1);
  assert.deepEqual(r.writes[0].cols, ["state"]); // hand-added cells/formulas elsewhere in the row stay untouched
  assert.equal(r.results[0].state, "submitted");
  assert.equal(r.results[0]._row, 2);
});

test("a failed expect anywhere -> conflict and no writes at all", () => {
  const r = planBatch([
    { op: "append", tab: "Sends", rows: [{ task_id: "4" }] },
    { op: "update", tab: "Tasks", id: 4, patch: { state: "approved" }, expect: { state: "submitted" } },
  ], tables(), counter());
  assert.deepEqual(r, { conflict: true });
});

test("later steps see earlier ones (double flip conflicts)", () => {
  const step = { op: "update", tab: "Tasks", id: 4, patch: { state: "submitted" }, expect: { state: "on_process" } };
  assert.deepEqual(planBatch([step, step], tables(), counter()), { conflict: true });
});

test("append assigns consecutive ids from the counter and new rows below the last", () => {
  const r = planBatch([{ op: "append", tab: "Tasks", rows: [{ title: "a" }, { title: "b" }] }], tables(), counter());
  assert.deepEqual(r.results[0].map((x) => [x.id, x._row]), [["5", 3], ["6", 4]]);
  assert.equal(r.results[0][0].state, ""); // every header present
});

test("append on a tab without an id column assigns no id", () => {
  const r = planBatch([{ op: "append", tab: "Buildings", rows: [{ name: "B2" }] }], tables(), counter());
  assert.deepEqual(r.results[0], [{ name: "B2", type: "", owner: "", _row: 3 }]);
});

test("expect ignores stray spaces typed into the sheet (the app reads cells trimmed)", () => {
  const t = tables();
  t.Tasks.rows[0].owner_name = "Ann ";
  const r = planBatch([{ op: "update", tab: "Tasks", id: 4, patch: { owner_id: "U2" }, expect: { owner_name: "Ann" } }], t, counter());
  assert.equal(r.results[0].owner_id, "U2");
});

test("update by sheet row keeps booleans (checkboxes) and checks expect", () => {
  const t = { L: { headers: ["ชื่อ", "อนุมัติ"], rows: [{ "ชื่อ": "V", "อนุมัติ": "false", _row: 7 }] } };
  const step = (who) => ({ op: "update", tab: "L", key: "_row", id: 7, patch: { "อนุมัติ": true, "ชื่อ": 5 }, expect: { "ชื่อ": who } });
  const r = planBatch([step("V")], t, counter());
  assert.equal(r.results[0]["อนุมัติ"], true);
  assert.equal(r.results[0]["ชื่อ"], "5");
  assert.deepEqual(planBatch([step("other")], t, counter()), { conflict: true });
});

test("update of a missing id -> not found", () =>
  assert.deepEqual(planBatch([{ op: "update", tab: "Tasks", id: 99, patch: { title: "x" } }], tables(), counter()), { error: "not found" }));

test("patch cannot change the id", () =>
  assert.equal(planBatch([{ op: "update", tab: "Tasks", id: 4, patch: { id: "7" } }], tables(), counter()).results[0].id, "4"));

test("Invoices tab has the invoice columns, ids come from the counter", () => {
  assert.deepEqual(HEADERS.Invoices, ["id", "building", "subject", "amount", "billed_on", "transfer_on", "receipt_on", "status", "note", "created_by", "created_at", "updated_at"]);
  const t = { Invoices: { headers: HEADERS.Invoices, rows: [] } };
  const r = planBatch([{ op: "append", tab: "Invoices", rows: [{ subject: "ค่าส่วนกลาง", amount: "1500" }] }], t, () => 1);
  assert.equal(r.results[0][0].id, "1");
  assert.equal(r.results[0][0].status, "");
});

test("update can match a row by another column (Buildings have no id): key = name", () => {
  const r = planBatch([{ op: "update", tab: "Buildings", key: "name", id: "B1", patch: { owner: "ทีมบี" } }], tables(), counter());
  assert.equal(r.results[0].owner, "ทีมบี");
  assert.deepEqual(r.writes[0].cols, ["owner"]);
});

test("update by key with no match -> not found", () =>
  assert.deepEqual(planBatch([{ op: "update", tab: "Buildings", key: "name", id: "Nope", patch: { owner: "x" } }], tables(), counter()), { error: "not found" }));

test("News tab columns (deleted_at = soft delete, pinned = 1 or blank)", () =>
  assert.deepEqual(HEADERS.News, ["id", "title", "body", "pinned", "created_by", "created_at", "deleted_at"]));

test("rowsToDelete: matching sheet rows, bottom first (so deleting one keeps the others numbered)", () => {
  const rows = [{ _row: 2, created_by: "demo" }, { _row: 3, created_by: "UA" }, { _row: 5, created_by: " demo " }, { _row: 6, created_by: "" }];
  assert.deepEqual(rowsToDelete(rows, "created_by", ["demo"]), [5, 2]);
  assert.deepEqual(rowsToDelete(rows, "created_by", []), []);
});
