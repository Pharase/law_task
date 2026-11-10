// ส่งงาน files are also copied to Google Drive (Apps Script op saveUpload): <UPLOAD_FOLDER_ID>/<staff name>/<driveName>.
// A copied file gets backed_up_at + drive_url, so the 1-year cleanup may later drop the Supabase copy; Drive keeps it.
import { clean, driveName } from "./driveName.ts";
import { sheet } from "./sheet.ts";
import type { Task } from "./sheetRows.ts";
import { bucket, db, must } from "./shared.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Copies not-yet-archived files to Drive, one by one. A failure is logged and retried by the next daily cleanup. */
export async function archiveFiles(ids: string[], tasks: Map<number, Pick<Task, "id" | "building" | "title">>): Promise<number> {
  if (!ids.length) return 0;
  const files: Row[] = must(await db.from("files")
    .select("id, path, name, mime, task_id, created_at, owner_profile:profiles!files_owner_fkey(staff_name, display_name)")
    .in("id", ids).is("backed_up_at", null).is("deleted_at", null));
  let done = 0;
  for (const f of files) {
    try {
      const blob = must(await bucket.download(f.path)) as Blob;
      const folder = clean(f.owner_profile?.staff_name || f.owner_profile?.display_name || "unknown");
      const name = driveName(f.created_at.slice(0, 10), tasks.get(Number(f.task_id)), f.name);
      const { url } = await sheet("saveUpload", { folder, name, mime: f.mime, base64: base64(new Uint8Array(await blob.arrayBuffer())) }, 60_000);
      if (!url) throw new Error("script returned no url: redeploy the script (New version)");
      must(await db.from("files").update({ backed_up_at: new Date().toISOString(), drive_url: url }).eq("id", f.id));
      done++;
    } catch (e) {
      console.error("archive", f.id, e);
    }
  }
  return done;
}
