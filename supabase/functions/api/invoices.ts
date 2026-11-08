// Invoices (Invoice tab): rows in the Google Sheet "Invoices" tab <-> typed invoices. Pure: no Deno or npm imports.
import { type Bad, normDate, type Row } from "./sheetRows.ts";
import { isAllBuildings } from "./responsibility.ts";

export const INVOICE_STATUS = ["ตั้งเบิก", "รอวางบิล", "รอโอนเงิน", "รอใบเสร็จ", "เรียบร้อย"] as const;
export const BUILDING_TYPES = ["บ้านจัดสรร", "อาคารชุด"] as const;
export type InvoiceStatus = typeof INVOICE_STATUS[number];
export type Invoice = {
  id: number; building: string; type: string; subject: string; amount: number;
  billed_on: string | null; transfer_on: string | null; receipt_on: string | null;
  status: InvoiceStatus; note: string | null; created_at: string; updated_at: string | null;
};

const DATE_FIELDS = ["billed_on", "transfer_on", "receipt_on"] as const;
const cell = (r: Row, k: string) => String(r[k] ?? "").trim();
/** "1,500.50" -> 1500.5; null unless a number >= 0. */
const money = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** Valid invoices (type taken from the building) and bad rows for admins. */
export function parseInvoices(rows: Row[], buildingTypes: Map<string, string>) {
  const invoices: Invoice[] = [], bad: Bad[] = [];
  for (const r of rows) {
    const fail = (reason: string) => bad.push({ row: r._row, tab: "Invoices", reason });
    const id = /^\d+$/.test(cell(r, "id")) ? Number(cell(r, "id")) : 0;
    if (!id) { fail("id is missing or not a number"); continue; }
    const subject = cell(r, "subject");
    if (!subject) { fail("subject (ขอเบิกเรื่อง) is empty"); continue; }
    const amount = money(cell(r, "amount"));
    if (amount === null) { fail("amount (ยอด) is not a number"); continue; }
    const status = (cell(r, "status") || "ตั้งเบิก") as InvoiceStatus;
    if (!INVOICE_STATUS.includes(status)) { fail(`unknown status "${status}"`); continue; }
    const dates: Record<string, string | null> = {};
    const badDate = DATE_FIELDS.find((k) => { const v = cell(r, k); dates[k] = v ? normDate(v) : null; return v && !dates[k]; });
    if (badDate) { fail(`${badDate} is not a YYYY-MM-DD date`); continue; }
    const building = cell(r, "building");
    invoices.push({
      id, building, type: buildingTypes.get(building) ?? "", subject, amount,
      billed_on: dates.billed_on, transfer_on: dates.transfer_on, receipt_on: dates.receipt_on,
      status, note: cell(r, "note") || null, created_at: cell(r, "created_at"), updated_at: cell(r, "updated_at") || null,
    });
  }
  return { invoices, bad };
}

/** Admin input -> sheet cells. Throws a message the admin can act on. */
export function invoiceCells(body: Record<string, unknown>, buildings: string[]): Record<string, string> {
  const s = (k: string) => String(body[k] ?? "").trim();
  const building = s("building");
  if (!buildings.includes(building)) throw new Error("pick a building from the list");
  const subject = s("subject");
  if (!subject || subject.length > 300) throw new Error("ขอเบิกเรื่อง (subject) is required, max 300 characters");
  const amount = money(s("amount"));
  if (amount === null || amount > 1e12) throw new Error("ยอด (amount) must be a number, e.g. 1500 or 1,500.50");
  const status = s("status") || "ตั้งเบิก";
  if (!(INVOICE_STATUS as readonly string[]).includes(status)) throw new Error("สถานะ (status) must be one of " + INVOICE_STATUS.join(", "));
  const out: Record<string, string> = { building, subject, amount: String(Math.round(amount * 100) / 100) };
  for (const k of DATE_FIELDS) {
    const v = s(k);
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !normDate(v))) throw new Error(`${k}: วันที่ไม่ถูกต้อง (bad date)`);
    out[k] = v;
  }
  const note = s("note");
  if (note.length > 1000) throw new Error("note is over 1000 characters");
  return { ...out, status, note };
}

/**
 * Who sees which invoices: admins see all; anyone else only invoices of buildings they look after
 * (owner in ข้อมูลการมอบหมาย), plus "ทุกนิติ" invoices, which concern every building.
 */
export function visibleInvoices<T extends { building: string }>(invoices: T[], ownerOf: Map<string, string>, me: { role: string; name: string }): T[] {
  if (me.role === "admin") return invoices;
  return invoices.filter((i) => isAllBuildings(i.building) || (ownerOf.get(i.building) ?? "") === me.name);
}
