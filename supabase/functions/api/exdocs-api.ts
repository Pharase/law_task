// Ex Doc library (spec "Button C"). PDFs go straight from the admin's browser to Storage via a signed upload URL.
import { db, found, HttpError, type Me, must } from "./shared.ts";

const exdocs = db.storage.from("exdocs");
const MAX_BYTES = 20 * 1024 * 1024;
const PATH = /^[0-9a-f-]{36}\.pdf$/;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function checkTitle(title: unknown): string {
  const t = String(title ?? "").trim();
  if (!t || t.length > 200) throw new HttpError(400, "title is required (max 200 characters)");
  return t;
}

export async function memberExDocActions(action: string, _body: Row, _me: Me): Promise<unknown> {
  if (action !== "listExDocs") return undefined;
  const docs: Row[] = must(await db.from("exdocs").select("id, title, name, size, path, created_at"));
  docs.sort((a, b) => a.title.localeCompare(b.title, "th"));
  if (!docs.length) return [];
  const urls = must(await exdocs.createSignedUrls(docs.map((d) => d.path), 3600));
  return docs.map(({ path: _p, ...d }, i) => {
    const previewUrl = urls[i]?.signedUrl ?? null;
    // Storage serves an attachment with this file name when `download=` is added (what the SDK does too).
    return { ...d, previewUrl, downloadUrl: previewUrl && `${previewUrl}&download=${encodeURIComponent(d.name)}` };
  });
}

export async function adminExDocActions(action: string, body: Row, me: Me): Promise<unknown> {
  switch (action) {
    case "exdocUploadUrl": {
      const name = String(body.name ?? "");
      const size = Number(body.size);
      if (!/\.pdf$/i.test(name)) throw new HttpError(400, "only PDF files");
      if (!(size > 0) || size > MAX_BYTES) throw new HttpError(400, "file must be under 20 MB");
      const path = `${crypto.randomUUID()}.pdf`;
      const { signedUrl } = must(await exdocs.createSignedUploadUrl(path));
      return { path, signedUrl };
    }

    case "exdocSave": {
      const path = String(body.path ?? "");
      if (!PATH.test(path)) throw new HttpError(400, "bad path");
      // The object must really be there (upload finished) before we list it.
      const probe = await exdocs.createSignedUrl(path, 60);
      if (probe.error) throw new HttpError(400, "upload not found, try again");
      return must(await db.from("exdocs").insert({
        path, title: checkTitle(body.title), name: String(body.name ?? "document.pdf").slice(0, 255),
        size: Number(body.size) || 0, uploaded_by: me.line_user_id,
      }).select("id, title, name, size, created_at").single());
    }

    case "exdocRename":
      return found(must(await db.from("exdocs").update({ title: checkTitle(body.title) })
        .eq("id", String(body.id)).select("id, title").maybeSingle()), "document");

    case "exdocDelete": {
      const doc = found(must(await db.from("exdocs").select("id, path").eq("id", String(body.id)).maybeSingle()), "document");
      must(await exdocs.remove([doc.path])); // storage first: a leftover row can be deleted again, a leftover file can't be found
      must(await db.from("exdocs").delete().eq("id", doc.id));
      return { deleted: doc.id };
    }
  }
  return undefined;
}
