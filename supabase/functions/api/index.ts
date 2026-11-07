// The only door into the database. Every request carries the LINE ID token in
// `x-line-id-token`; we verify it with LINE, then act with the service role.
import { createClient } from "npm:@supabase/supabase-js@2";
import { newCode, normalizeCode } from "./codes.ts";

const LINE_CHANNEL_ID = Deno.env.get("LINE_CHANNEL_ID")!;
const RETENTION_DAYS = 365;
const MAX_WRONG_CODES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf",
};

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const bucket = db.storage.from("uploads");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-line-id-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const must = <T>({ data, error }: { data: T; error: unknown }) => { if (error) throw error; return data; };

async function verifyLine(idToken: string | null) {
  if (!idToken) throw new HttpError(401, "missing LINE ID token");
  const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    body: new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID }),
  });
  if (!r.ok) throw new HttpError(401, "invalid or expired LINE ID token");
  return await r.json() as { sub: string; name?: string; picture?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const form = req.headers.get("content-type")?.startsWith("multipart/") ? await req.formData() : null;
    const body = form ? Object.fromEntries(form) : await req.json();

    // Public on purpose: it only deletes what is already past retention, so a stranger calling it changes nothing.
    if (body.action === "cleanup") return json(await cleanup());

    const line = await verifyLine(req.headers.get("x-line-id-token"));
    const me = must(await db.from("profiles").upsert({
      line_user_id: line.sub, display_name: line.name, picture_url: line.picture, last_seen_at: new Date().toISOString(),
    }).select().single());
    const approved = me.role === "member" || me.role === "admin";
    const isAdmin = me.role === "admin";

    switch (body.action) {
      case "me":
        return json(me);

      case "redeem": {
        if (approved) return json(me);
        if (me.locked) throw new HttpError(403, "locked: too many wrong codes, contact an admin");
        const invite = must(await db.from("invites")
          .update({ used_by: me.line_user_id, used_at: new Date().toISOString() })
          .eq("code", normalizeCode(String(body.code ?? "")))
          .is("used_at", null).gt("expires_at", new Date().toISOString())
          .select().maybeSingle());
        if (!invite) {
          // shortcut: read-then-write counter, parallel guesses can slip a few extra tries; fine for a 31^8 code space
          const failed = me.failed_codes + 1;
          must(await db.from("profiles").update({ failed_codes: failed, locked: failed >= MAX_WRONG_CODES })
            .eq("line_user_id", me.line_user_id));
          throw new HttpError(400, failed >= MAX_WRONG_CODES
            ? "locked: too many wrong codes, contact an admin"
            : `wrong or expired code (${MAX_WRONG_CODES - failed} tries left)`);
        }
        return json(must(await db.from("profiles")
          .update({ role: invite.role, staff_name: invite.staff_name, failed_codes: 0 })
          .eq("line_user_id", me.line_user_id).select().single()));
      }

      case "upload": {
        if (!approved) throw new HttpError(403, "not approved");
        const file = form?.get("file");
        if (!(file instanceof File)) throw new HttpError(400, "no file");
        const ext = MIME_EXT[file.type];
        if (!ext) throw new HttpError(400, "only JPG, PNG, WEBP, HEIC or PDF");
        if (file.size > MAX_BYTES) throw new HttpError(400, "file is over 10 MB");
        const path = `${me.line_user_id}/${crypto.randomUUID()}.${ext}`;
        must(await bucket.upload(path, file, { contentType: file.type }));
        return json(must(await db.from("files").insert({
          owner: me.line_user_id, path, name: file.name, mime: file.type, size: file.size,
        }).select().single()));
      }

      case "myFiles": {
        if (!approved) throw new HttpError(403, "not approved");
        const files = must(await db.from("files").select().eq("owner", me.line_user_id).order("created_at", { ascending: false }));
        if (!files.length) return json([]);
        const urls = must(await bucket.createSignedUrls(files.map((f) => f.path), 3600));
        return json(files.map((f, i) => ({ ...f, url: urls[i].signedUrl })));
      }
    }

    // Everything below is admin-only.
    if (!isAdmin) throw new HttpError(403, "admins only");
    switch (body.action) {
      case "listUsers":
        return json(must(await db.from("profiles").select().order("created_at", { ascending: false })));

      case "createInvite": {
        const staff_name = String(body.staff_name ?? "").trim();
        if (!staff_name) throw new HttpError(400, "staff name is required");
        if (!["member", "admin"].includes(body.role)) throw new HttpError(400, "role must be member or admin");
        return json(must(await db.from("invites")
          .insert({ code: newCode(), staff_name, role: body.role, created_by: me.line_user_id })
          .select().single()));
      }

      case "setRole": {
        if (!["member", "admin", "revoked"].includes(body.role)) throw new HttpError(400, "bad role");
        if (body.line_user_id === me.line_user_id) throw new HttpError(400, "you can't change your own role");
        return json(must(await db.from("profiles").update({ role: body.role, locked: false, failed_codes: 0 })
          .eq("line_user_id", body.line_user_id).select().single()));
      }

      case "unlock":
        return json(must(await db.from("profiles").update({ locked: false, failed_codes: 0 })
          .eq("line_user_id", body.line_user_id).select().single()));
    }
    throw new HttpError(400, "unknown action");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});

async function cleanup() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString();
  let deleted = 0;
  for (;;) {
    const old = must(await db.from("files").select("id, path").lt("created_at", cutoff).limit(100));
    if (!old.length) break;
    must(await bucket.remove(old.map((f) => f.path))); // storage first: a leftover row is retried tomorrow, a leftover file never would be
    must(await db.from("files").delete().in("id", old.map((f) => f.id)));
    deleted += old.length;
  }
  must(await db.from("invites").delete().is("used_at", null).lt("expires_at", new Date().toISOString()));
  return { deleted };
}
