import { test } from "node:test";
import assert from "node:assert/strict";
import { INVOICE_STATUS, invoiceCells, parseInvoices } from "./invoices.ts";

const types = new Map([["B1", "บ้านจัดสรร"], ["B2", "อาคารชุด"], ["B3", ""]]);
const row = (over: Record<string, string> = {}) => ({
  _row: 2, id: "1", building: "B1", subject: "ค่าส่วนกลาง", amount: "1,500.50", billed_on: "2569-11-01", transfer_on: "",
  receipt_on: "", status: "รอโอนเงิน", note: "", created_by: "UA", created_at: "2026-11-08T01:00:00Z", updated_at: "", ...over,
});

test("statuses are the four steps in order", () =>
  assert.deepEqual(INVOICE_STATUS, ["รอทนายวางบิล", "รอนิติชำระเงิน", "รอทนายส่งใบเสร็จ", "เสร็จสิ้น"]));

test("rows with an old status name still show, under the new name", () => {
  const got = ["ตั้งเบิก", "รอวางบิล", "รอโอนเงิน", "รอใบเสร็จ", "เรียบร้อย"]
    .map((status, i) => parseInvoices([row({ id: String(i + 1), status })], types).invoices[0]?.status);
  assert.deepEqual(got, ["รอทนายวางบิล", "รอทนายวางบิล", "รอนิติชำระเงิน", "รอทนายส่งใบเสร็จ", "เสร็จสิ้น"]);
});

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
  ["no subject", { subject: " " }], ["bad amount", { amount: "abc" }],
  ["negative amount", { amount: "-5" }], ["unknown status", { status: "จ่ายแล้ว" }], ["bad date", { receipt_on: "tomorrow" }],
] as const) {
  test(`bad invoice row is reported and left out: ${name}`, () => {
    const { invoices, bad } = parseInvoices([row(over)], types);
    assert.equal(invoices.length, 0);
    assert.deepEqual(bad.map((b) => [b.tab, b.row]), [["Invoices", 2]]);
  });
}

test("blank status counts as the first step (a row typed by hand)", () =>
  assert.equal(parseInvoices([row({ status: "" })], types).invoices[0].status, "รอทนายวางบิล"));

const buildings = ["B1", "B2", "ทุกนิติ"];
const input = { building: "B1", subject: " ค่าน้ำ ", amount: "2,000", billed_on: "2026-11-20", transfer_on: "", receipt_on: "", status: "รอนิติชำระเงิน", note: "" };

test("invoiceCells: trims, cleans the amount, keeps ISO dates, blanks stay blank", () =>
  assert.deepEqual(invoiceCells(input, buildings), {
    building: "B1", subject: "ค่าน้ำ", amount: "2000", billed_on: "2026-11-20", transfer_on: "", receipt_on: "", status: "รอนิติชำระเงิน", note: "",
  }));

test("invoiceCells: status defaults to the first step; an old name is saved as the new one", () => {
  assert.equal(invoiceCells({ ...input, status: undefined }, buildings).status, "รอทนายวางบิล");
  assert.equal(invoiceCells({ ...input, status: "เรียบร้อย" }, buildings).status, "เสร็จสิ้น");
});

test("invoiceCells: ทุกนิติ is not a building for an invoice", () =>
  assert.throws(() => invoiceCells({ ...input, building: "ทุกนิติ" }, buildings), /ทุกนิติ/));

for (const [name, over, msg] of [
  ["unknown building", { building: "Nowhere" }, /building/],
  ["no subject", { subject: "" }, /subject|เรื่อง/],
  ["bad amount", { amount: "1.2.3" }, /amount|ยอด/],
  ["bad date", { billed_on: "20/11/2026" }, /date|วันที่/],
  ["bad status", { status: "x" }, /status|สถานะ/],
] as const) {
  test(`invoiceCells rejects: ${name}`, () => assert.throws(() => invoiceCells({ ...input, ...over }, buildings), msg));
}

test("visibleInvoices: admins see all; a member only invoices of buildings they look after (+ ทุกนิติ)", async () => {
  const { visibleInvoices } = await import("./invoices.ts");
  const owners = new Map([["KL2", "ทีมนุ่น"], ["SD7", "ทีมมิน"], ["ทุกนิติ", ""], ["The One", ""]]);
  const inv = (id: number, building: string) => ({ id, building }) as never;
  const list = [inv(1, "KL2"), inv(2, "SD7"), inv(3, "ทุกนิติ"), inv(4, "The One")];
  const ids = (xs: { id: number }[]) => xs.map((x) => x.id);
  assert.deepEqual(ids(visibleInvoices(list, owners, { role: "admin", name: "Admin" })), [1, 2, 3, 4]);
  assert.deepEqual(ids(visibleInvoices(list, owners, { role: "member", name: "ทีมนุ่น" })), [1, 3]);
  assert.deepEqual(ids(visibleInvoices(list, owners, { role: "member", name: "ทีมใหม่" })), [3]);
});

test("hand-typed rows: dd/mm/yyyy dates (พ.ศ. or ค.ศ.) and amounts with ฿ / บาท are accepted", () => {
  const { invoices, bad } = parseInvoices([row({ billed_on: "1/11/2569", transfer_on: "05/11/2026", amount: "฿ 1,500.50 บาท" })], types);
  assert.deepEqual(bad, []);
  assert.equal(invoices[0].billed_on, "2026-11-01");
  assert.equal(invoices[0].transfer_on, "2026-11-05");
  assert.equal(invoices[0].amount, 1500.5);
});

test("a row typed without an id still shows (read-only: id <= 0) and is listed for the admin", () => {
  const { invoices, bad } = parseInvoices([row({ id: "", _row: 7 } as never)], types);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].id, -7);
  assert.deepEqual(bad.map((b) => b.row), [7]);
});
