// Invoice tab: admins see and edit all invoices; a หัวหน้างาน sees only invoices of the buildings they look after
// (filtered on the server, see visibleInvoices). Filter tabs บ้านจัดสรร / อาคารชุด come from the building's type.
import { BUILDING_TYPES, invoiceCells, parseInvoices, visibleInvoices } from "./invoices.ts";
import { batch, sheet } from "./sheet.ts";
import { HttpError, type Me } from "./shared.ts";
import type { Row } from "./sheetRows.ts";

async function loadInvoices() {
  const { tabs } = await sheet("read", { tabs: ["Invoices", "Buildings"] });
  const buildings = (tabs.Buildings as Row[])
    .map((b) => ({ name: String(b.name ?? "").trim(), type: String(b.type ?? "").trim(), owner: String(b.owner ?? "").trim() }))
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
  if (me.role === "admin") return data;
  // everyone else: only their buildings' invoices (+ ทุกนิติ); no other building names, no sheet-row warnings
  const p = me as Me & { staff_name?: string | null; display_name?: string | null };
  const name = (p.staff_name || p.display_name || p.line_user_id).trim();
  const ownerOf = new Map(data.buildings.map((b) => [b.name, b.owner]));
  return {
    invoices: visibleInvoices(data.invoices, ownerOf, { role: me.role, name }),
    buildings: data.buildings.filter((b) => b.owner === name),
    types: data.types,
    bad: [],
  };
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
