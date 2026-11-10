import { test } from "node:test";
import assert from "node:assert/strict";
import { lienPatch, parseItems, summarize } from "./lien.ts";

let n = 1;
const condo = (b: string, unit: string, o: Record<string, string> = {}) => ({
  _row: ++n, "หัวหน้างาน": "เคน", "ชื่อนิติบุคคล": b, "ห้อง/บ้านเลขที่": unit, "รายชื่อ": "x", "จำนอง": "false", "ไม่ทราบข้อมูล": "false",
  "วันแจ้ง\nบุริมสิทธิ์": "", "เจ้าหนี้จำนอง": "ธนาคาร", "จำนวนเดือนที่ค้าง": "", "ยอดที่ค้างชำระ": "", "ปัจจุบันดำเนินการถึงขั้นตอนไหน": "",
  "เข้าเงื่อนไข\nเสนอราคา": "false", "เสนอราคาทนาย": "false", "อนุมัติ": "false", "ชะลอ": "false", "หมายเหตุ": "", ...o,
});
const village = (b: string, unit: string, o: Record<string, string> = {}) => ({
  _row: ++n, "ชื่อ": b, "ห้อง/บ้านเลขที่": unit, "รายชื่อ": "นาย ก", "วันแจ้ง\nอายัด": "", "จำนวนเดือนที่ค้าง": "",
  "เข้าเงื่อนไข\nเสนอราคา": "false", "เสนอราคาทนาย": "false", "อนุมัติ": "false", "ชะลอ": "false", ...o,
});

test("condo summary: same columns as the old สรุปการดำเนินงาน", () => {
  const rows = [
    condo("A", "101", { "จำนอง": "true", "วันแจ้ง\nบุริมสิทธิ์": "2025-08-15", "จำนวนเดือนที่ค้าง": "24", "เข้าเงื่อนไข\nเสนอราคา": "true", "เสนอราคาทนาย": "true", "อนุมัติ": "true" }),
    condo("A", "102", { "จำนอง": "true", "จำนวนเดือนที่ค้าง": "ุ6", "เสนอราคาทนาย": "true", "ชะลอ": "true" }),
    condo("A", "103", { "วันแจ้ง\nบุริมสิทธิ์": "2025-01-01", "จำนวนเดือนที่ค้าง": "3", "เสนอราคาทนาย": "true" }),
    condo("A", "", { "จำนอง": "true", "จำนวนเดือนที่ค้าง": "12" }), // no unit: not counted
    condo("B", ""),
  ];
  assert.deepEqual(summarize("condo", parseItems("condo", rows)), [
    { building: "A", over6: 2, eligible: 1, notEligible: 1, quoted: 3, approved: 1, delayed: 1, waiting: 1, todo: 2, doing: 1, done: 1 },
    { building: "B", over6: 0, eligible: 0, notEligible: 0, quoted: 0, approved: 0, delayed: 0, waiting: 0, todo: 0, doing: 0, done: 0 },
  ]);
});

test("village: to do = ค้าง >= 6 months, done = วันแจ้งอายัด filled (may exceed to do, like the old sheet)", () => {
  const items = parseItems("village", [
    village("V", "9/1", { "จำนวนเดือนที่ค้าง": "6", "วันแจ้ง\nอายัด": "27 ตค 68" }),
    village("V", "9/2", { "จำนวนเดือนที่ค้าง": "12" }),
    village("V", "9/3", { "จำนวนเดือนที่ค้าง": "3", "วันแจ้ง\nอายัด": "2025-01-01" }),
  ]);
  const [s] = summarize("village", items);
  assert.deepEqual([s.todo, s.doing, s.done], [2, 0, 2]);
  assert.equal(items[0].notifiedOn, "27 ตค 68");
  assert.equal(items[1].approved, false);
});

test("lienPatch maps to the row's own headers, keeps booleans, refuses other columns", () => {
  const row = condo("A", "1");
  assert.deepEqual(lienPatch("condo", row, { approved: true, notifiedOn: " 2025-08-15 ", note: "" }),
    { "อนุมัติ": true, "วันแจ้ง\nบุริมสิทธิ์": "2025-08-15", "หมายเหตุ": "" });
  assert.throws(() => lienPatch("condo", row, { eligible: true }), /แก้ในชีต/);
  assert.throws(() => lienPatch("condo", row, { months: "9" }), /แก้ในชีต/);
  assert.throws(() => lienPatch("village", village("V", "1"), { mortgage: true }), /แก้ในชีต/);
  assert.throws(() => lienPatch("condo", row, { approved: "yes" }), /true or false/);
  assert.throws(() => lienPatch("condo", row, {}), /ไม่มีอะไรเปลี่ยน/);
});
