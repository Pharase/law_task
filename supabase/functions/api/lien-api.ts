// Button E "อายัดและแจ้งบุริมสิทธิ": everyone sees the summary; admins open a building's list and edit a row's status.
import { type Kind, lienPatch, parseItems, summarize, TABS } from "./lien.ts";
import { batch, sheet } from "./sheet.ts";
import { HttpError, type Me } from "./shared.ts";
import type { Row } from "./sheetRows.ts";

async function load() {
  const { tabs } = await sheet("read", { tabs: Object.values(TABS) });
  return { condo: tabs[TABS.condo] as Row[], village: tabs[TABS.village] as Row[] };
}
const summary = (raw: Record<Kind, Row[]>) => ({
  condo: summarize("condo", parseItems("condo", raw.condo)),
  village: summarize("village", parseItems("village", raw.village)),
});
const kindOf = (v: unknown): Kind => {
  if (v !== "condo" && v !== "village") throw new HttpError(400, "kind must be condo or village");
  return v;
};
const detail = (raw: Record<Kind, Row[]>, kind: Kind, building: string) =>
  parseItems(kind, raw[kind]).filter((it) => it.building === building);

// deno-lint-ignore no-explicit-any
export async function memberLienActions(action: string, _body: any, _me: Me): Promise<unknown> {
  return action === "lienSummary" ? summary(await load()) : undefined;
}

// deno-lint-ignore no-explicit-any
export async function adminLienActions(action: string, body: any, _me: Me): Promise<unknown> {
  switch (action) {
    case "lienDetail": {
      const kind = kindOf(body.kind);
      return { items: detail(await load(), kind, String(body.building ?? "")) };
    }
    case "saveLien": {
      // body: {kind, row, building, unit, name, patch}; building/unit/name are what the admin saw, so a row
      // moved or changed in the sheet meanwhile gives a conflict instead of writing to the wrong person
      const kind = kindOf(body.kind);
      const rowNo = Number(body.row);
      if (!Number.isInteger(rowNo) || rowNo < 2) throw new HttpError(400, "row is required");
      const raw = await load();
      const row = raw[kind].find((r) => r._row === rowNo);
      if (!row) throw new HttpError(409, "แถวนี้ไม่อยู่ในชีตแล้ว กรุณาโหลดใหม่");
      const seen = parseItems(kind, [row])[0];
      if (!seen || seen.building !== body.building || seen.unit !== body.unit || seen.name !== body.name) {
        throw new HttpError(409, "แถวนี้ถูกแก้ในชีตระหว่างนี้ กรุณาโหลดใหม่");
      }
      let patch;
      try { patch = lienPatch(kind, row, body.patch); } catch (e) { throw new HttpError(400, (e as Error).message); }
      const expect = Object.fromEntries(Object.keys(row).filter((h) => h !== "_row").map((h) => [h, String(row[h] ?? "")])
        .filter(([h]) => !(h in patch)));
      const ok = await batch([{ op: "update", tab: TABS[kind], key: "_row", id: rowNo, patch, expect }]);
      if (!ok) throw new HttpError(409, "แถวนี้ถูกแก้ในชีตระหว่างนี้ กรุณาโหลดใหม่");
      const fresh = await load();
      return { items: detail(fresh, kind, seen.building), summary: summary(fresh) };
    }
  }
  return undefined;
}
