// "ข้อมูลการมอบหมาย": which หัวหน้างาน (staff name) looks after which building. Stored in the Buildings tab, column `owner`.
// Pure: no Deno or npm imports.
export type BuildingRow = { name: string; type: string; owner: string };

/** "ทุกนิติ…" is not a building: it means every building. Nobody owns it, and anyone may get a task for it. */
export const isAllBuildings = (name: string) => String(name).trim().startsWith("ทุกนิติ");

/** Buildings tab rows -> trimmed, de-duplicated (first row wins), sorted (Thai-aware). */
export function buildingRows(rows: Record<string, unknown>[]): BuildingRow[] {
  const seen = new Map<string, BuildingRow>();
  for (const r of rows) {
    const name = String(r.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.set(name, { name, type: String(r.type ?? "").trim(), owner: String(r.owner ?? "").trim() });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
}

/**
 * The first owner the building is NOT assigned to, or null when the task is allowed.
 * Someone with no buildings yet is not restricted, so the app works before the table is filled.
 */
export function outsideResponsibility(building: string, ownerNames: string[], buildings: BuildingRow[]): string | null {
  if (isAllBuildings(building)) return null; // a task for every building can go to anyone
  for (const name of ownerNames) {
    const theirs = buildings.filter((b) => b.owner === name);
    if (theirs.length && !theirs.some((b) => b.name === building)) return name;
  }
  return null;
}
