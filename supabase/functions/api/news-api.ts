// Home "ข่าวสาร · News": everyone reads; admins add, pin / unpin and delete (soft: deleted_at is set, the row stays).
import { newsCells, parseNews } from "./news.ts";
import { batch, sheet } from "./sheet.ts";
import { HttpError, type Me } from "./shared.ts";

const listNews = async () => parseNews((await sheet("read", { tabs: ["News"] })).tabs.News);

const newsId = (body: Record<string, unknown>) => {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "news id is required");
  return id;
};

// deno-lint-ignore no-explicit-any
export async function memberNewsActions(action: string, _body: any, _me: Me): Promise<unknown> {
  return action === "listNews" ? listNews() : undefined;
}

// deno-lint-ignore no-explicit-any
export async function adminNewsActions(action: string, body: any, me: Me): Promise<unknown> {
  switch (action) {
    case "addNews": {
      let cells;
      try { cells = newsCells(body); } catch (e) { throw new HttpError(400, (e as Error).message); }
      await batch([{ op: "append", tab: "News", rows: [{ ...cells, created_by: me.line_user_id, created_at: new Date().toISOString() }] }]);
      return listNews();
    }
    case "pinNews":
      await batch([{ op: "update", tab: "News", id: newsId(body), patch: { pinned: body.pinned ? "1" : "" } }]);
      return listNews();
    case "deleteNews":
      await batch([{ op: "update", tab: "News", id: newsId(body), patch: { deleted_at: new Date().toISOString() } }]);
      return listNews();
  }
  return undefined;
}
