// Ex Doc library (spec "Button C"). Files (PDF, Word, pictures; see exdocTypes.ts) go straight from the admin's
// browser to Storage via a signed upload URL.
import { fileKind, isExDocPath } from "./exdocTypes.ts";
import { db, found, HttpError, type Me, must } from "./shared.ts";

const exdocs = db.storage.from("exdocs");
const MAX_BYTES = 20 * 1024 * 1024;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function checkTitle(title: unknown): string {
  const t = String(title ?? "").trim();
  if (!t || t.length > 200) throw new HttpError(400, "title is required (max 200 characters)");
  return t;
}

/** Optional subfolder name inside a group: blank -> null. */
function subgroupOf(v: unknown): string | null {
  const n = String(v ?? "").trim();
  if (n.length > 100) throw new HttpError(400, "subfolder name is over 100 characters");
  return n || null;
}

function checkGroupName(name: unknown): string {
  const n = String(name ?? "").trim();
  if (!n || n.length > 100) throw new HttpError(400, "group name is required (max 100 characters)");
  return n;
}

/** null (no group) or the id of an existing group. */
async function groupId(id: unknown): Promise<string | null> {
  if (id === null || id === undefined || id === "") return null;
  return found(must(await db.from("exdoc_groups").select("id").eq("id", String(id)).maybeSingle()), "group").id;
}

/** { groups, docs }: both A-Z (Thai-aware); group_id is null for documents without a group. */
export async function memberExDocActions(action: string, _body: Row, _me: Me): Promise<unknown> {
  if (action !== "listExDocs") return undefined;
  const groups: Row[] = must(await db.from("exdoc_groups").select("id, name"));
  groups.sort((a, b) => a.name.localeCompare(b.name, "th"));
  const docs: Row[] = must(await db.from("exdocs").select("id, title, name, size, path, created_at, group_id, subgroup"));
  docs.sort((a, b) => a.title.localeCompare(b.title, "th"));
  if (!docs.length) return { groups, docs: [] };
  const urls = must(await exdocs.createSignedUrls(docs.map((d) => d.path), 3600));
  return {
    groups,
    docs: docs.map(({ path: _p, ...d }, i) => {
      const previewUrl = urls[i]?.signedUrl ?? null;
      // Storage serves an attachment with this file name when `download=` is added (what the SDK does too).
      // preview: the browser can show it (PDF, pictures); Word files are download-only
      return { ...d, preview: fileKind(d.name)?.preview ?? true, previewUrl, downloadUrl: previewUrl && `${previewUrl}&download=${encodeURIComponent(d.name)}` };
    }),
  };
}

export async function adminExDocActions(action: string, body: Row, me: Me): Promise<unknown> {
  switch (action) {
    case "exdocUploadUrl": {
      const name = String(body.name ?? "");
      const size = Number(body.size);
      const kind = fileKind(name);
      if (!kind) throw new HttpError(400, "only PDF, Word (.doc/.docx) or pictures (.jpg/.png)");
      if (!(size > 0) || size > MAX_BYTES) throw new HttpError(400, "file must be under 20 MB");
      const path = `${crypto.randomUUID()}.${kind.ext}`;
      const { signedUrl } = must(await exdocs.createSignedUploadUrl(path));
      return { path, signedUrl, contentType: kind.mime };
    }

    case "exdocSave": {
      const path = String(body.path ?? "");
      if (!isExDocPath(path)) throw new HttpError(400, "bad path");
      // The object must really be there (upload finished) before we list it.
      const probe = await exdocs.createSignedUrl(path, 60);
      if (probe.error) throw new HttpError(400, "upload not found, try again");
      return must(await db.from("exdocs").insert({
        path, title: checkTitle(body.title), name: String(body.name ?? "document.pdf").slice(0, 255),
        size: Number(body.size) || 0, uploaded_by: me.line_user_id, group_id: await groupId(body.group_id),
        subgroup: subgroupOf(body.subgroup),
      }).select("id, title, name, size, created_at, group_id, subgroup").single());
    }

    case "exdocRename":
      return found(must(await db.from("exdocs").update({ title: checkTitle(body.title) })
        .eq("id", String(body.id)).select("id, title").maybeSingle()), "document");

    case "exdocSetSubgroup": // move a document into a subfolder of its group (blank = out of any subfolder)
      return found(must(await db.from("exdocs").update({ subgroup: subgroupOf(body.subgroup) })
        .eq("id", String(body.id)).select("id, subgroup").maybeSingle()), "document");

    case "exdocSetGroup":
      return found(must(await db.from("exdocs").update({ group_id: await groupId(body.group_id) })
        .eq("id", String(body.id)).select("id, group_id").maybeSingle()), "document");

    case "exdocGroupSave": {
      // id given = rename, otherwise create. A duplicate name hits the unique index.
      const name = checkGroupName(body.name);
      const r = body.id
        ? await db.from("exdoc_groups").update({ name }).eq("id", String(body.id)).select("id, name").maybeSingle()
        : await db.from("exdoc_groups").insert({ name }).select("id, name").single();
      if ((r.error as { code?: string } | null)?.code === "23505") throw new HttpError(409, "a group with this name already exists");
      return found(must(r), "group");
    }

    case "exdocGroupDelete":
      // Its documents fall back to "no group" (on delete set null); no file is deleted.
      return found(must(await db.from("exdoc_groups").delete().eq("id", String(body.id)).select("id").maybeSingle()), "group");

    case "exdocDelete": {
      const doc = found(must(await db.from("exdocs").select("id, path").eq("id", String(body.id)).maybeSingle()), "document");
      must(await exdocs.remove([doc.path])); // storage first: a leftover row can be deleted again, a leftover file can't be found
      must(await db.from("exdocs").delete().eq("id", doc.id));
      return { deleted: doc.id };
    }
  }
  return undefined;
}
