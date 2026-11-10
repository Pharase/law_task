// Button E "อายัดและแจ้งบุริมสิทธิ": read-only summary of the two list tabs copied from the old sheet.
import { CONDO_TAB, lienSummary, VILLAGE_TAB } from "./lien.ts";
import { sheet } from "./sheet.ts";
import type { Me } from "./shared.ts";

// deno-lint-ignore no-explicit-any
export async function memberLienActions(action: string, _body: any, _me: Me): Promise<unknown> {
  if (action !== "lienSummary") return undefined;
  const { tabs } = await sheet("read", { tabs: [CONDO_TAB, VILLAGE_TAB] });
  return lienSummary(tabs[CONDO_TAB], tabs[VILLAGE_TAB]);
}
