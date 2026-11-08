// Backup-before-delete (spec "Retention"). Admins download due files as a ZIP in the browser, then mark them backed up;
// the daily cleanup deletes only due + backed-up files and keeps the row (deleted_at) for task timelines.
import { bangkokDate } from "./dates.ts";
import { cutoff, graceCutoff, isDeletable } from "./retention.ts";
import { bucket, db, type Me, must } from "./shared.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** True when today's LINE summary ran out of quota (notify_log, from the daily summary). */
async function quotaLow(): Promise<boolean> {
  const { data, error } = await db.from("notify_log").select("id").eq("run_date", bangkokDate(new Date())).eq("error", "quota").limit(1);
  return !error && !!data?.length;
}

export async function adminBackupActions(action: string, body: Row, me: Me): Promise<unknown> {
  switch (action) {
    case "backupList": {
      const files: Row[] = must(await db.from("files")
        .select("id, name, task_id, created_at, path, owner_profile:profiles!files_owner_fkey(staff_name, display_name)")
        .is("deleted_at", null).is("backed_up_at", null).lt("created_at", cutoff(new Date()).toISOString())
        .order("created_at"));
      const urls = files.length ? must(await bucket.createSignedUrls(files.map((f) => f.path), 3600)) : [];
      return {
        quotaLow: await quotaLow(),
        files: files.map(({ path: _p, owner_profile, ...f }, i) => ({
          ...f, owner_name: owner_profile?.staff_name || owner_profile?.display_name || "unknown", url: urls[i]?.signedUrl,
        })),
      };
    }

    case "backupDone": {
      const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (!ids.length) return { count: 0 };
      // Only files that are really due can be marked, so a stray call can't schedule young files for deletion.
      const rows = must(await db.from("files").update({ backed_up_at: new Date().toISOString(), backed_up_by: me.line_user_id })
        .in("id", ids).is("deleted_at", null).is("backed_up_at", null).lt("created_at", cutoff(new Date()).toISOString())
        .select("id"));
      return { count: rows.length };
    }
  }
  return undefined;
}

/** Public, idempotent: deletes only files that are due AND were backed up more than BACKUP_GRACE_DAYS ago. */
export async function cleanup() {
  const now = new Date();
  let deleted = 0;
  for (;;) {
    const batch: Row[] = must(await db.from("files").select("id, path, created_at, backed_up_at, deleted_at")
      .is("deleted_at", null).lt("backed_up_at", graceCutoff(now).toISOString()).lt("created_at", cutoff(now).toISOString()).limit(100));
    const doomed = batch.filter((f) => isDeletable(f as Parameters<typeof isDeletable>[0], now)); // same rule as the query, checked again in code
    if (!doomed.length) break;
    must(await bucket.remove(doomed.map((f) => f.path))); // storage first: a leftover row is retried tomorrow
    must(await db.from("files").update({ deleted_at: now.toISOString() }).in("id", doomed.map((f) => f.id)));
    deleted += doomed.length;
  }
  must(await db.from("invites").delete().is("used_at", null).lt("expires_at", now.toISOString()));
  return { deleted };
}
