// Invoices (Invoice tab): rows in the Google Sheet "Invoices" tab <-> typed invoices. Pure: no Deno or npm imports.
import { type Bad, normDate, type Row } from "./sheetRows.ts";
import { isAllBuildings } from "./responsibility.ts";
import { bangkokDate } from "./dates.ts";
import { clean } from "./driveName.ts";

export const INVOICE_STATUS = ["รอทนายวางบิล", "รอนิติชำระเงิน", "รอทนายส่งใบเสร็จ", "เสร็จสิ้น"] as const;
/** Old status names (before 2026-11-09) -> the new ones, so older rows keep showing. */
const OLD_STATUS: Record<string, string> = {
  "ตั้งเบิก": "รอทนายวางบิล", "รอวางบิล": "รอทนายวางบิล", "รอโอนเงิน": "รอนิติชำระเงิน", "รอใบเสร็จ": "รอทนายส่งใบเสร็จ", "เรียบร้อย": "เสร็จสิ้น",
};
/** Blank = first step; old names mapped; anything else returned as typed (and then rejected). */
const statusOf = (s: string) => (s ? OLD_STATUS[s] ?? s : INVOICE_STATUS[0]);
export const BUILDING_TYPES = ["บ้านจัดสรร", "อาคารชุด"] as const;
export type InvoiceStatus = typeof INVOICE_STATUS[number];
export type Invoice = {
  id: number; building: string; type: string; subject: string; lawyer: string | null; amount: number;
  billed_on: string | null; transfer_on: string | null; receipt_on: string | null;
  status: InvoiceStatus; note: string | null; created_at: string; updated_at: string | null;
};

const DATE_FIELDS = ["billed_on", "transfer_on", "receipt_on"] as const;

/** LINE text for the building's หัวหน้าทีม when an invoice moves to `status` (from `before`, undefined = new); null = no message. */
const NOTICE: Partial<Record<string, string>> = {
  "รอนิติชำระเงิน": "ทนายความมีวางบิลใหม่นะคะ สามารถดูรายละเอียดและดาวน์โหลดใบวางบิลได้ที่นี่หรือเมนู Invoice",
  "เสร็จสิ้น": "ทนายความส่งใบเสร็จให้เรียบร้อยแล้วนะคะ สามารถดูรายละเอียดและดาวน์โหลดใบเสร็จได้ที่นี่หรือเมนู Invoice",
};
export const invoiceNotice = (status: string, before?: string): string | null => (status !== before && NOTICE[status]) || null;

/** The step at which the building's หัวหน้าทีม may add files to an invoice (admins: any step). */
export const MEMBER_UPLOAD_STATUS: InvoiceStatus = "รอนิติชำระเงิน";

/** `name`, or "name (2).ext", "(3)"... if taken: an upload with a taken name would replace (trash) that file. */
export function freeName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  let out = name;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base} (${n})${ext}`;
  return out;
}

const cell = (r: Row, k: string) => String(r[k] ?? "").trim();
/** "1,500.50", "฿1,500", "1500 บาท" -> number; null unless a number >= 0. */
const money = (s: string) => {
  const t = s.replace(/[,\s฿]|บาท/g, "");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** YYYY-MM-DD, or a hand-typed d/m/yyyy (years above 2400 are พ.ศ.) -> YYYY-MM-DD; null when not a real date. */
function looseDate(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  return m ? normDate(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`) : normDate(v);
}

/** Valid invoices (type taken from the building) and bad rows for admins. */
export function parseInvoices(rows: Row[], buildingTypes: Map<string, string>) {
  const invoices: Invoice[] = [], bad: Bad[] = [];
  for (const r of rows) {
    const fail = (reason: string) => bad.push({ row: r._row, tab: "Invoices", reason });
    // a row typed by hand without an id still shows, read-only (negative id = its sheet row); the admin is told why
    let id = /^\d+$/.test(cell(r, "id")) ? Number(cell(r, "id")) : 0;
    if (!id) { fail("ไม่มี id (พิมพ์เพิ่มในชีตเอง): แสดงได้ แต่แก้ในแอปไม่ได้ · no id, shown read-only"); id = -r._row; }
    const subject = cell(r, "subject");
    if (!subject) { fail("subject (ขอเบิกเรื่อง) is empty"); continue; }
    const amount = money(cell(r, "amount"));
    if (amount === null) { fail("amount (ยอด) is not a number"); continue; }
    const status = statusOf(cell(r, "status")) as InvoiceStatus;
    if (!INVOICE_STATUS.includes(status)) { fail(`unknown status "${status}"`); continue; }
    const dates: Record<string, string | null> = {};
    const badDate = DATE_FIELDS.find((k) => { const v = cell(r, k); dates[k] = v ? looseDate(v) : null; return v && !dates[k]; });
    if (badDate) { fail(`${badDate} ไม่ใช่วันที่ (ใช้ วว/ดด/ปปปป หรือ YYYY-MM-DD)`); continue; }
    const building = cell(r, "building");
    invoices.push({
      id, building, type: buildingTypes.get(building) ?? "", subject, lawyer: cell(r, "lawyer") || null, amount,
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
  if (isAllBuildings(building)) throw new Error("ทุกนิติ ใช้กับใบแจ้งหนี้ไม่ได้ · pick one building");
  const subject = s("subject");
  if (!subject || subject.length > 300) throw new Error("ขอเบิกเรื่อง (subject) is required, max 300 characters");
  const amount = money(s("amount"));
  if (amount === null || amount > 1e12) throw new Error("ยอด (amount) must be a number, e.g. 1500 or 1,500.50");
  const status = statusOf(s("status"));
  if (!(INVOICE_STATUS as readonly string[]).includes(status)) throw new Error("สถานะ (status) must be one of " + INVOICE_STATUS.join(", "));
  const lawyer = s("lawyer"); // optional, free text (the form suggests names)
  if (lawyer.length > 100) throw new Error("ทนาย (lawyer) is over 100 characters");
  const out: Record<string, string> = { building, subject, lawyer, amount: String(Math.round(amount * 100) / 100) };
  for (const k of DATE_FIELDS) {
    const v = s(k);
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !normDate(v))) throw new Error(`${k}: วันที่ไม่ถูกต้อง (bad date)`);
    out[k] = v;
  }
  const note = s("note");
  if (note.length > 1000) throw new Error("note is over 1000 characters");
  return { ...out, status, note };
}

/** Drive folder for an invoice's files: "2026-11-17-ไฮคอนโด ท่าศาลา 2-คชจ ชั้นโนติส-ตั้ม" (date = day it was added, Bangkok). */
export function invoiceFolderName(inv: Pick<Invoice, "building" | "subject" | "lawyer" | "created_at" | "billed_on">): string {
  const made = new Date(inv.created_at);
  const day = isNaN(made.getTime()) ? inv.billed_on ?? "" : bangkokDate(made);
  return [day, inv.building, inv.subject, inv.lawyer ?? ""].map(clean).filter(Boolean).join("-");
}

/**
 * Who sees which invoices: admins see all; anyone else only invoices of buildings they look after
 * (owner in ข้อมูลการมอบหมาย), plus "ทุกนิติ" invoices, which concern every building.
 */
export function visibleInvoices<T extends { building: string }>(invoices: T[], ownerOf: Map<string, string>, me: { role: string; name: string }): T[] {
  if (me.role === "admin") return invoices;
  return invoices.filter((i) => isAllBuildings(i.building) || (ownerOf.get(i.building) ?? "") === me.name);
}
