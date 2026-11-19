// Invoice tab: admins see and edit all invoices; a หัวหน้างาน sees only invoices of the buildings they look after
// (filtered on the server, see visibleInvoices). Filter tabs บ้านจัดสรร / อาคารชุด come from the building's type.
// Attachments (📎): files in Google Drive <INVOICE_FOLDER_ID>/<invoiceFolderName>/, added and deleted by admins only.
// Anyone who sees the invoice can open them, through a signed copy (driveCopy.ts).
import { base64 } from "./archive.ts";
import { BUILDING_TYPES, type Invoice, invoiceCells, invoiceFolderName, parseInvoices, visibleInvoices } from "./invoices.ts";
import { batch, isUnknownOp, scriptTooOld, sheet } from "./sheet.ts";
import { HttpError, MAX_BYTES, type Me, MIME_EXT } from "./shared.ts";
import { driveFileLinks, type DriveFile, dropCopies } from "./driveCopy.ts";
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

async function listFor(me: Me) {
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

/** The invoice, if `me` may see it (rows without an id have no files). */
async function invoiceFor(me: Me, id: unknown): Promise<Invoice> {
  const inv = (await listFor(me)).invoices.find((i) => i.id > 0 && i.id === Number(id));
  if (!inv) throw new HttpError(404, "invoice not found");
  return inv;
}

/** Files in the invoice's Drive folder, oldest first; the script also renames the folder if the invoice was edited. */
async function driveFiles(inv: Invoice): Promise<DriveFile[]> {
  // script not redeployed yet: nothing can have been uploaded, so show "ไม่มีไฟล์แนบ" instead of an error
  const { files = [] } = await sheet("invoiceFiles", { id: inv.id, folder: invoiceFolderName(inv) }, 30_000)
    .catch((e) => { if (isUnknownOp(e)) return { files: [] }; throw e; });
  return (files as DriveFile[]).sort((a, b) => a.modified.localeCompare(b.modified));
}

// deno-lint-ignore no-explicit-any
export async function memberInvoiceActions(action: string, body: any, me: Me): Promise<unknown> {
  switch (action) {
    case "listInvoices":
      return listFor(me);

    case "invoiceFiles":
      return driveFiles(await invoiceFor(me, body.id));

    case "invoiceFileUrl": {
      const inv = await invoiceFor(me, body.id);
      const file = (await driveFiles(inv)).find((f) => f.id === String(body.fileId ?? ""));
      if (!file) throw new HttpError(404, "file not found");
      return driveFileLinks(file, async () => (await sheet("invoiceFileData", { id: inv.id, fileId: file.id }, 60_000)).base64);
    }
  }
  return undefined;
}

// deno-lint-ignore no-explicit-any
export async function adminInvoiceActions(action: string, body: any, me: Me): Promise<unknown> {
  switch (action) {
    case "saveInvoice": {
      const { buildings } = await loadInvoices();
      let cells;
      try { cells = invoiceCells(body, buildings.map((b) => b.name)); } catch (e) { throw new HttpError(400, (e as Error).message); }
      const now = new Date().toISOString();
      let id = Number(body.id);
      if (id) {
        // edit: the row is matched by id; a row deleted by hand meanwhile gives 404 from sheet()
        await batch([{ op: "update", tab: "Invoices", id, patch: { ...cells, updated_at: now } }]);
      } else {
        const results = await batch([{ op: "append", tab: "Invoices", rows: [{ ...cells, created_by: me.line_user_id, created_at: now }] }]);
        id = Number(results?.[0]?.[0]?.id);
      }
      return { ...await loadInvoices(), savedId: id }; // savedId: the form uploads its files to this invoice next
    }

    case "uploadInvoiceFile": {
      const inv = await invoiceFor(me, body.id);
      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, "no file");
      if (!MIME_EXT[file.type]) throw new HttpError(400, "only JPG, PNG, WEBP or PDF");
      if (file.size > MAX_BYTES) throw new HttpError(400, "file is over 10 MB");
      const name = file.name.replace(/[\/\\\r\n]+/g, " ").trim().slice(0, 150) || "file";
      // same file name = new version: the script keeps only the newest (the old one is trashed after the new one is saved)
      const { replaced = [] } = await sheet("invoiceUpload", {
        id: inv.id, folder: invoiceFolderName(inv), name, mime: file.type, base64: base64(new Uint8Array(await file.arrayBuffer())),
      }, 60_000).catch(scriptTooOld);
      await Promise.all((replaced as string[]).map(dropCopies));
      return driveFiles(inv);
    }

    case "deleteInvoiceFile": {
      const inv = await invoiceFor(me, body.id);
      const fileId = String(body.fileId ?? "");
      await sheet("invoiceFileDelete", { id: inv.id, fileId }); // to Drive's trash: restorable there for 30 days
      await dropCopies(fileId);
      return driveFiles(inv);
    }
  }
  return undefined;
}
