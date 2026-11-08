// The only door into the database. Every request carries the LINE ID token in
// `x-line-id-token`; we verify it with LINE, then act with the service role.
import { newCode, normalizeCode } from "./codes.ts";
import { bucket, db, found, HttpError, must } from "./shared.ts";
import { adminTaskActions, memberTaskActions } from "./tasks-api.ts";
import { adminExDocActions, memberExDocActions } from "./exdocs-api.ts";
import { adminBackupActions, cleanup } from "./backup-api.ts";
import { digest } from "./notify-api.ts";
import { pickProfile } from "./profile.ts";

// Feature handlers return undefined for actions they don't own. Member handlers run for any approved user.
const MEMBER_HANDLERS = [memberTaskActions, memberExDocActions];
const ADMIN_HANDLERS = [adminTaskActions, adminExDocActions, adminBackupActions];

const LINE_CHANNEL_ID = Deno.env.get("LINE_CHANNEL_ID")!;
const MAX_WRONG_CODES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
}; // no HEIC: only Apple devices can display it

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-line-id-token, x-line-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

async function verifyLine(idToken: string | null) {
  if (!idToken) throw new HttpError(401, "missing LINE ID token");
  const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    body: new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID }),
  });
  if (!r.ok) throw new HttpError(401, "invalid or expired LINE ID token");
  return await r.json() as { sub: string; name?: string; picture?: string };
}

/** Current LINE profile via the LIFF access token; null on any problem (the ID token values are kept). */
async function liveProfile(accessToken: string | null) {
  if (!accessToken) return null;
  try {
    // The access token must be issued for OUR channel, or someone could pass another app's token.
    const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
    if (!v.ok || (await v.json()).client_id !== LINE_CHANNEL_ID) return null;
    const p = await fetch("https://api.line.me/v2/profile", { headers: { Authorization: `Bearer ${accessToken}` } });
    return p.ok ? await p.json() as { userId: string; displayName?: string; pictureUrl?: string } : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const form = req.headers.get("content-type")?.startsWith("multipart/") ? await req.formData() : null;
    const body = form ? Object.fromEntries(form) : await req.json().catch(() => ({}));

    // Public on purpose: it only deletes files that are due AND backed up, so a stranger calling it changes nothing.
    if (body.action === "cleanup") return json(await cleanup());
    // Public on purpose: runs at most once per Bangkok weekday after 09:00, otherwise does nothing.
    if (body.action === "digest") return json(await digest());

    const line = await verifyLine(req.headers.get("x-line-id-token"));
    // Refresh name + picture from the live LINE profile once per page open ("me"), not on every action.
    const profile = pickProfile(line, body.action === "me" ? await liveProfile(req.headers.get("x-line-access-token")) : null);
    const me = must(await db.from("profiles").upsert({
      line_user_id: line.sub, ...profile, last_seen_at: new Date().toISOString(),
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
        if (!ext) throw new HttpError(400, "only JPG, PNG, WEBP or PDF");
        if (file.size > MAX_BYTES) throw new HttpError(400, "file is over 10 MB");
        const path = `${me.line_user_id}/${crypto.randomUUID()}.${ext}`;
        must(await bucket.upload(path, file, { contentType: file.type }));
        const row = await db.from("files").insert({
          owner: me.line_user_id, path, name: file.name, mime: file.type, size: file.size,
        }).select().single();
        if (row.error) await bucket.remove([path]); // a file without a row would never be auto-deleted
        return json(must(row));
      }

      case "myFiles": {
        if (!approved) throw new HttpError(403, "not approved");
        const files = must(await db.from("files").select().eq("owner", me.line_user_id).order("created_at", { ascending: false }));
        if (!files.length) return json([]);
        const urls = must(await bucket.createSignedUrls(files.map((f: { path: string }) => f.path), 3600));
        return json(files.map((f: object, i: number) => ({ ...f, url: urls[i].signedUrl })));
      }
    }

    if (approved) {
      for (const handle of MEMBER_HANDLERS) {
        const r = await handle(body.action, body, me);
        if (r !== undefined) return json(r);
      }
    }

    // Everything below is admin-only.
    if (!isAdmin) throw new HttpError(403, "admins only");
    for (const handle of ADMIN_HANDLERS) {
      const r = await handle(body.action, body, me);
      if (r !== undefined) return json(r);
    }
    switch (body.action) {
      case "listUsers":
        return json(must(await db.from("profiles").select().order("created_at", { ascending: false })));

      case "createInvite": {
        const staff_name = String(body.staff_name ?? "").trim();
        if (!staff_name || staff_name.length > 100) throw new HttpError(400, "staff name is required (max 100 characters)");
        if (!["member", "admin"].includes(body.role)) throw new HttpError(400, "role must be member or admin");
        return json(must(await db.from("invites")
          .insert({ code: newCode(), staff_name, role: body.role, created_by: me.line_user_id })
          .select().single()));
      }

      case "setRole": {
        if (!["member", "admin", "revoked"].includes(body.role)) throw new HttpError(400, "bad role");
        if (body.line_user_id === me.line_user_id) throw new HttpError(400, "you can't change your own role");
        // Optional staff name, set when an admin approves someone directly (the sheet names task owners by it).
        const staff_name = body.staff_name === undefined ? undefined : String(body.staff_name).trim();
        if (staff_name !== undefined && (!staff_name || staff_name.length > 100)) throw new HttpError(400, "staff name is required (max 100 characters)");
        return json(found(must(await db.from("profiles").update({ role: body.role, locked: false, failed_codes: 0, ...(staff_name ? { staff_name } : {}) })
          .eq("line_user_id", body.line_user_id).select().maybeSingle())));
      }

      case "unlock":
        return json(found(must(await db.from("profiles").update({ locked: false, failed_codes: 0 })
          .eq("line_user_id", body.line_user_id).select().maybeSingle())));
    }
    throw new HttpError(400, "unknown action");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});

