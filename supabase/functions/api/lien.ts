// "อายัดและแจ้งบุริมสิทธิ" summary: same counts as the old sheet สรุปการดำเนินงาน J/K/L
// (old-system/รายชื่อผู้ค้างค่าส่วนกลางเกิน 6 เดือน.xlsx), computed from its two list tabs.
import type { Row } from "./sheetRows.ts";

export const CONDO_TAB = "รายชื่อค้างคสก (อช)";
export const VILLAGE_TAB = "รายชื่อค้างคสก (จส)";

export type LienRow = { building: string; todo: number; doing: number; done: number };

// headers in the sheet have line breaks ("วันแจ้ง\nบุริมสิทธิ์"), so match them without spaces;
// the unit column is "…/บ้านเลขที่", matched by its end
const col = (r: Row, name: string) => {
  const k = Object.keys(r).find((h) => {
    const t = h.replace(/\s/g, "");
    return name === "บ้านเลขที่" ? t.endsWith(name) : t === name;
  });
  return k ? String(r[k] ?? "").trim() : "";
};
const ticked = (v: string) => ["true", "1"].includes(v.toLowerCase());

function tally(rows: Row[], nameCol: string, todo: (r: Row) => boolean, done: (r: Row) => boolean): LienRow[] {
  const by = new Map<string, LienRow>();
  for (const r of rows) {
    const building = col(r, nameCol);
    if (!building) continue;
    const s = by.get(building) ?? { building, todo: 0, doing: 0, done: 0 };
    by.set(building, s); // every building listed shows, even with 0
    if (!col(r, "บ้านเลขที่")) continue; // the old formulas COUNTA the unit column
    if (todo(r)) s.todo++;
    if (done(r)) s.done++;
    s.doing = s.todo - s.done; // as the old sheet: can go negative when dates are filled for rows under 6 months
  }
  return [...by.values()];
}

/**
 * อาคารชุด (สรุปการอายัดหรือจดบุริมสิทธิ์): to do = จำนอง ticked; done = also has วันแจ้งบุริมสิทธิ์.
 * หมู่บ้านจัดสรร (สรุปการอายัด): to do = ค้าง ≥ 6 เดือน; done = has วันแจ้งอายัด.
 */
export function lienSummary(condo: Row[], village: Row[]) {
  return {
    condo: tally(condo, "ชื่อนิติบุคคล", (r) => ticked(col(r, "จำนอง")), (r) => ticked(col(r, "จำนอง")) && !!col(r, "วันแจ้งบุริมสิทธิ์")),
    // digits only: typos like "ุ6" still count, as they did in the old sheet
    village: tally(village, "ชื่อ", (r) => Number(col(r, "จำนวนเดือนที่ค้าง").replace(/[^\d.]/g, "")) >= 6, (r) => !!col(r, "วันแจ้งอายัด")),
  };
}
