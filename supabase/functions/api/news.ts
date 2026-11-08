// Home "ข่าวสาร · News": rows of the Google Sheet "News" tab. Pure: no Deno or npm imports.
import type { Row } from "./sheetRows.ts";

export type News = { id: number; title: string; body: string | null; pinned: boolean; created_at: string };

const cell = (r: Row, k: string) => String(r[k] ?? "").trim();
const isOn = (s: string) => /^(1|true|yes|y|x|✓)$/i.test(s); // a hand-typed TRUE / x also counts as pinned

/** Visible news: not deleted, with a title. Pinned first, then newest first. */
export function parseNews(rows: Row[]): News[] {
  return rows
    .filter((r) => /^\d+$/.test(cell(r, "id")) && cell(r, "title") && !cell(r, "deleted_at"))
    .map((r) => ({ id: Number(cell(r, "id")), title: cell(r, "title"), body: cell(r, "body") || null, pinned: isOn(cell(r, "pinned")), created_at: cell(r, "created_at") }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

/** Admin input -> sheet cells. Throws a message the admin can act on. */
export function newsCells(body: Record<string, unknown>): { title: string; body: string; pinned: string } {
  const title = String(body.title ?? "").trim();
  if (!title || title.length > 150) throw new Error("หัวข้อข่าว (title) is required, max 150 characters");
  const text = String(body.body ?? "").trim();
  if (text.length > 3000) throw new Error("ข้อความยาวเกิน 3000 ตัวอักษร (body is over 3000 characters)");
  return { title, body: text, pinned: body.pinned === true || body.pinned === "1" || body.pinned === "on" ? "1" : "" };
}
