// Home "ข่าวสาร · News": everyone reads; admins add, pin / unpin and delete (soft: deleted_at is set, the row stays).
import { newsCells, parseNews } from "./news.ts";
import { batch, sheet } from "./sheet.ts";
import { db, HttpError, type Me, must } from "./shared.ts";

/** Visible news with `read` = this person has opened it (unread shows a dot). */
const listNews = async (me: Me) => {
  const [rows, reads] = await Promise.all([
    sheet("read", { tabs: ["News"] }),
    db.from("news_reads").select("news_id").eq("line_user_id", me.line_user_id),
  ]);
  const read = new Set(must(reads).map((r: { news_id: number }) => r.news_id));
  return parseNews(rows.tabs.News).map((n) => ({ ...n, read: read.has(n.id) }));
};

const newsId = (body: Record<string, unknown>) => {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "news id is required");
  return id;
};

// deno-lint-ignore no-explicit-any
export async function memberNewsActions(action: string, body: any, me: Me): Promise<unknown> {
  if (action === "listNews") return listNews(me);
  if (action === "readNews") { // opened in the list: idempotent, a second open changes nothing
    must(await db.from("news_reads").upsert({ line_user_id: me.line_user_id, news_id: newsId(body) }, { ignoreDuplicates: true }));
    return { ok: true };
  }
  return undefined;
}

// deno-lint-ignore no-explicit-any
export async function adminNewsActions(action: string, body: any, me: Me): Promise<unknown> {
  switch (action) {
    case "addNews": {
      let cells;
      try { cells = newsCells(body); } catch (e) { throw new HttpError(400, (e as Error).message); }
      await batch([{ op: "append", tab: "News", rows: [{ ...cells, created_by: me.line_user_id, created_at: new Date().toISOString() }] }]);
      return listNews(me);
    }
    case "pinNews":
      await batch([{ op: "update", tab: "News", id: newsId(body), patch: { pinned: body.pinned ? "1" : "" } }]);
      return listNews(me);
    case "deleteNews":
      await batch([{ op: "update", tab: "News", id: newsId(body), patch: { deleted_at: new Date().toISOString() } }]);
      return listNews(me);
  }
  return undefined;
}
