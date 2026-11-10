import { test } from "node:test";
import assert from "node:assert/strict";
import { lienSummary } from "./lien.ts";

const condo = (b: string, unit: string, mortgaged: string, notified: string) =>
  ({ _row: 2, "ชื่อนิติบุคคล": b, "ห้อง/บ้านเลขที่": unit, "จำนอง": mortgaged, "วันแจ้ง\nบุริมสิทธิ์": notified, "เจ้าหนี้จำนอง": "ธนาคาร", "รายชื่อ": "x" });
const village = (b: string, unit: string, months: string, frozen: string) =>
  ({ _row: 2, "ชื่อ": b, "ห้อง/บ้านเลขที่": unit, "จำนวนเดือนที่ค้าง": months, "วันแจ้ง\nอายัด": frozen, "รายชื่อ": "นาย ก" });

test("condo: to do = จำนอง ticked, done = ticked + วันแจ้งบุริมสิทธิ์; rows without a unit are not counted", () => {
  const { condo: rows } = lienSummary(
    [condo("A", "101", "true", "2025-08-15"), condo("A", "102", "true", ""), condo("A", "103", "false", "2025-01-01"),
      condo("A", "", "true", "x"), condo("B", "", "", "")],
    [],
  );
  assert.deepEqual(rows, [{ building: "A", todo: 2, doing: 1, done: 1 }, { building: "B", todo: 0, doing: 0, done: 0 }]);
});

test("village: to do = ค้าง >= 6 months, done = วันแจ้งอายัด filled (can exceed to do, like the old sheet)", () => {
  const { village: rows } = lienSummary([], [
    village("V", "9/1", "6", "27 ตค 68"), village("V", "9/2", "12", ""), village("V", "9/3", "3", "2025-01-01"), village("V", "9/4", "ุ6", ""),
  ]);
  assert.deepEqual(rows, [{ building: "V", todo: 3, doing: 1, done: 2 }]);
});
