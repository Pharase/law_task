import { test } from "node:test";
import assert from "node:assert/strict";
import { INVOICE_STATUS, invoiceCells, parseInvoices } from "./invoices.ts";

const types = new Map([["B1", "บ้านจัดสรร"], ["B2", "อาคารชุด"], ["B3", ""]]);
const row = (over: Record<string, string> = {}) => ({
  _row: 2, id: "1", building: "B1", subject: "ค่าส่วนกลาง", amount: "1,500.50", billed_on: "2569-11-01", transfer_on: "",
  receipt_on: "", status: "รอโอนเงิน", note: "", created_by: "UA", created_at: "2026-11-08T01:00:00Z", updated_at: "", ...over,
});

test("statuses are the five steps in order", () =>
  assert.deepEqual(INVOICE_STATUS, ["ตั้งเบิก", "รอวางบิล", "รอโอนเงิน", "รอใบเสร็จ", "เรียบร้อย"]));

test("a good row parses: amount with commas, Buddhist date, type from the building", () => {
  const { invoices, bad } = parseInvoices([row()], types);
  assert.deepEqual(bad, []);
  assert.equal(invoices[0].amount, 1500.5);
  assert.equal(invoices[0].billed_on, "2026-11-01");
  assert.equal(invoices[0].transfer_on, null);
  assert.equal(invoices[0].type, "บ้านจัดสรร");
});

test("a building without a type (or not in Buildings) gets an empty type, the row still shows", () => {
  const { invoices } = parseInvoices([row({ building: "B3" }), row({ _row: 3, id: "2", building: "Gone" } as never)], types);
  assert.deepEqual(invoices.map((i) => i.type), ["", ""]);
});

for (const [name, over] of [
  ["missing id", { id: "" }], ["no subject", { subject: " " }], ["bad amount", { amount: "abc" }],
  ["negative amount", { amount: "-5" }], ["unknown status", { status: "จ่ายแล้ว" }], ["bad date", { receipt_on: "tomorrow" }],
] as const) {
  test(`bad invoice row is reported and left out: ${name}`, () => {
    const { invoices, bad } = parseInvoices([row(over)], types);
    assert.equal(invoices.length, 0);
    assert.deepEqual(bad.map((b) => [b.tab, b.row]), [["Invoices", 2]]);
  });
}

test("blank status counts as ตั้งเบิก (a row typed by hand)", () =>
  assert.equal(parseInvoices([row({ status: "" })], types).invoices[0].status, "ตั้งเบิก"));

const buildings = ["B1", "B2"];
const input = { building: "B1", subject: " ค่าน้ำ ", amount: "2,000", billed_on: "2026-11-20", transfer_on: "", receipt_on: "", status: "รอวางบิล", note: "" };

test("invoiceCells: trims, cleans the amount, keeps ISO dates, blanks stay blank", () =>
  assert.deepEqual(invoiceCells(input, buildings), {
    building: "B1", subject: "ค่าน้ำ", amount: "2000", billed_on: "2026-11-20", transfer_on: "", receipt_on: "", status: "รอวางบิล", note: "",
  }));

test("invoiceCells: status defaults to ตั้งเบิก", () =>
  assert.equal(invoiceCells({ ...input, status: undefined }, buildings).status, "ตั้งเบิก"));

for (const [name, over, msg] of [
  ["unknown building", { building: "Nowhere" }, /building/],
  ["no subject", { subject: "" }, /subject|เรื่อง/],
  ["bad amount", { amount: "1.2.3" }, /amount|ยอด/],
  ["bad date", { billed_on: "20/11/2026" }, /date|วันที่/],
  ["bad status", { status: "x" }, /status|สถานะ/],
] as const) {
  test(`invoiceCells rejects: ${name}`, () => assert.throws(() => invoiceCells({ ...input, ...over }, buildings), msg));
}
