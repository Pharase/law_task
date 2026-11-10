// "อายัดและแจ้งบุริมสิทธิ": the old sheet's สรุปการดำเนินงาน, computed by the app from the two list tabs
// (old-system/รายชื่อผู้ค้างค่าส่วนกลางเกิน 6 เดือน.xlsx). Admins also edit a row's status columns.
import type { Row } from "./sheetRows.ts";

export const TABS = { condo: "รายชื่อค้างคสก (อช)", village: "รายชื่อค้างคสก (จส)" } as const;
export type Kind = keyof typeof TABS;

// app field -> sheet header, written without spaces (headers have line breaks: "วันแจ้ง\nบุริมสิทธิ์")
const COMMON = {
  lead: "หัวหน้างาน", name: "รายชื่อ", creditor: "เจ้าหนี้จำนอง", months: "จำนวนเดือนที่ค้าง", owed: "ยอดที่ค้างชำระ",
  step: "ปัจจุบันดำเนินการถึงขั้นตอนไหน", eligible: "เข้าเงื่อนไขเสนอราคา", quoted: "เสนอราคาทนาย", approved: "อนุมัติ",
  delayed: "ชะลอ", note: "หมายเหตุ",
};
const FIELDS: Record<Kind, Record<string, string>> = {
  condo: { ...COMMON, building: "ชื่อนิติบุคคล", mortgage: "จำนอง", unknown: "ไม่ทราบข้อมูล", notifiedOn: "วันแจ้งบุริมสิทธิ์" },
  village: { ...COMMON, building: "ชื่อ", notifiedOn: "วันแจ้งอายัด" },
};
const BOOLS = ["mortgage", "unknown", "eligible", "quoted", "approved", "delayed"];
// what an admin may change in the app; เข้าเงื่อนไขเสนอราคา is a sheet formula, the rest is edited in the sheet
export const EDITABLE: Record<Kind, string[]> = {
  condo: ["mortgage", "unknown", "notifiedOn", "step", "quoted", "approved", "delayed", "note"],
  village: ["notifiedOn", "step", "quoted", "approved", "delayed", "note"],
};

/** The row's own header for a label (unit column is "…/บ้านเลขที่", matched by its end). */
export function headerOf(r: Row, label: string): string | undefined {
  return Object.keys(r).find((h) => {
    const t = h.replace(/\s/g, "");
    return label === "บ้านเลขที่" ? t.endsWith(label) : t === label;
  });
}
const cell = (r: Row, label: string) => {
  const k = headerOf(r, label);
  return k ? String(r[k] ?? "").trim() : "";
};
const ticked = (v: string) => ["true", "1"].includes(v.toLowerCase());

export type Item = { row: number; building: string; unit: string } & Record<string, string | boolean | number>;

export function parseItems(kind: Kind, rows: Row[]): Item[] {
  return rows.map((r) => {
    const it: Item = { row: Number(r._row), building: "", unit: cell(r, "บ้านเลขที่") };
    for (const [f, label] of Object.entries(FIELDS[kind])) it[f] = BOOLS.includes(f) ? ticked(cell(r, label)) : cell(r, label);
    return it;
  }).filter((it) => it.building);
}

export type Summary = {
  building: string; over6: number; eligible: number; notEligible: number; quoted: number; approved: number;
  delayed: number; waiting: number; todo: number; doing: number; done: number;
};

// digits only: typos like "ุ6" still count, as they did in the old sheet
const months = (it: Item) => Number(String(it.months).replace(/[^\d.]/g, ""));

/**
 * Same formulas as the old สรุปการดำเนินงาน (a row counts only with a unit number: COUNTA of that column).
 * อาคารชุด: ต้องดำเนินการ = จำนอง ticked; เรียบร้อย = also has วันแจ้งบุริมสิทธิ์.
 * หมู่บ้านจัดสรร: ต้องดำเนินการ = ค้าง ≥ 6 เดือน; เรียบร้อย = has วันแจ้งอายัด.
 * The differences (ไม่เข้าเงื่อนไข, รออนุมัติ, อยู่ระหว่าง) can go negative, as in the old sheet.
 */
export function summarize(kind: Kind, items: Item[]): Summary[] {
  const by = new Map<string, Summary>();
  for (const it of items) {
    const s = by.get(it.building) ?? { building: it.building, over6: 0, eligible: 0, notEligible: 0, quoted: 0, approved: 0, delayed: 0, waiting: 0, todo: 0, doing: 0, done: 0 };
    by.set(it.building, s); // every building listed shows, even with 0
    if (!it.unit) continue;
    if (months(it) >= 6) s.over6++;
    for (const f of ["eligible", "quoted", "approved", "delayed"] as const) if (it[f]) s[f]++;
    const todo = kind === "condo" ? !!it.mortgage : months(it) >= 6;
    if (todo) s.todo++;
    if (kind === "condo" ? todo && it.notifiedOn : it.notifiedOn) s.done++;
    s.notEligible = s.over6 - s.eligible;
    s.waiting = s.quoted - s.approved - s.delayed;
    s.doing = s.todo - s.done;
  }
  return [...by.values()];
}

/** Admin input -> {header: value} for the row's own headers. Throws a message the admin can act on. */
export function lienPatch(kind: Kind, row: Row, input: Record<string, unknown>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const [f, v] of Object.entries(input ?? {})) {
    if (!EDITABLE[kind].includes(f)) throw new Error(`แก้ "${f}" ในแอปไม่ได้ (แก้ในชีต)`);
    const h = headerOf(row, FIELDS[kind][f]);
    if (!h) throw new Error(`ไม่พบคอลัมน์ "${FIELDS[kind][f]}" ในชีต`);
    if (BOOLS.includes(f)) {
      if (typeof v !== "boolean") throw new Error(`${f} must be true or false`);
      out[h] = v;
    } else {
      const t = String(v ?? "").trim();
      if (t.length > 1000) throw new Error(`${FIELDS[kind][f]} ยาวเกินไป`);
      out[h] = t;
    }
  }
  if (!Object.keys(out).length) throw new Error("ไม่มีอะไรเปลี่ยน");
  return out;
}
