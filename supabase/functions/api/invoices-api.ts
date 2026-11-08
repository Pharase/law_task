// Invoice tab: everyone sees all invoices (filtered บ้านจัดสรร / อาคารชุด by the building's type); admins add and edit.
import { BUILDING_TYPES, invoiceCells, parseInvoices } from "./invoices.ts";
import { batch, sheet } from "./sheet.ts";
import { HttpError, type Me } from "./shared.ts";
import type { Row } from "./sheetRows.ts";

async function loadInvoices() {
  const { tabs } = await sheet("read", { tabs: ["Invoices", "Buildings"] });
  const buildings = (tabs.Buildings as Row[])
    .map((b) => ({ name: String(b.name ?? "").trim(), type: String(b.type ?? "").trim() }))
    .filter((b) => b.name)
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
  const { invoices, bad } = parseInvoices(tabs.Invoices as Row[], new Map(buildings.map((b) => [b.name, b.type])));
  invoices.sort((a, b) => b.id - a.id); // newest first
  return { invoices, buildings, types: BUILDING_TYPES, bad };
}

// deno-lint-ignore no-explicit-any
export async function memberInvoiceActions(action: string, _body: any, me: Me): Promise<unknown> {
  if (action !== "listInvoices") return undefined;
  const data = await loadInvoices();
  return me.role === "admin" ? data : { ...data, bad: [] }; // sheet-row warnings are for admins
}

// deno-lint-ignore no-explicit-any
export async function adminInvoiceActions(action: string, body: any, me: Me): Promise<unknown> {
  if (action !== "saveInvoice") return undefined;
  const { buildings } = await loadInvoices();
  let cells;
  try { cells = invoiceCells(body, buildings.map((b) => b.name)); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const now = new Date().toISOString();
  const id = Number(body.id);
  if (id) {
    // edit: the row is matched by id; a row deleted by hand meanwhile gives 404 from sheet()
    await batch([{ op: "update", tab: "Invoices", id, patch: { ...cells, updated_at: now } }]);
  } else {
    await batch([{ op: "append", tab: "Invoices", rows: [{ ...cells, created_by: me.line_user_id, created_at: now }] }]);
  }
  return loadInvoices();
}
