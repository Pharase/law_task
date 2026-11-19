// Opening a Google Drive file inside the app (invoice 📎, admin attachments on tasks), without giving anyone Drive access:
// the file is copied once per version to the private `invoice-files` bucket (path = <drive file id>/<modified ms>.<ext>;
// the bucket name is historic, it holds any of these copies) and opened by a one-hour signed link.
import { db, HttpError, MIME_EXT } from "./shared.ts";

const copies = db.storage.from("invoice-files");
export type DriveFile = { id: string; name: string; mime: string; size: number; modified: string };

/** Signed view / download links for a Drive file; fetchBase64 gets its bytes from the script when no copy is current. */
export async function driveFileLinks(file: DriveFile, fetchBase64: () => Promise<string | undefined>) {
  const ext = MIME_EXT[file.mime];
  if (!ext) throw new HttpError(400, "เปิดในแอปได้เฉพาะ PDF หรือรูป (JPG, PNG, WEBP) · open it in Google Drive");
  const version = `${new Date(file.modified).getTime()}.${ext}`, path = `${file.id}/${version}`;
  const step = <T>(what: string, r: { data: T; error: unknown }): T => {
    if (r.error) throw new HttpError(502, `เปิดไฟล์ไม่ได้ (${what}): ${(r.error as { message?: string }).message ?? r.error}`);
    return r.data;
  };
  const cached = step("storage list", await copies.list(file.id)) as { name: string }[];
  if (!cached.some((o) => o.name === version)) {
    const b64 = await fetchBase64();
    if (!b64) throw new HttpError(502, "เปิดไฟล์ไม่ได้ (Drive): the script returned no file");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    step("storage upload", await copies.upload(path, bytes, { contentType: file.mime, upsert: true }));
    const old = cached.filter((o) => o.name !== version).map((o) => `${file.id}/${o.name}`);
    if (old.length) await copies.remove(old); // older versions are no longer needed
  }
  const { signedUrl } = step("signed link", await copies.createSignedUrl(path, 3600)) as { signedUrl: string };
  return { previewUrl: signedUrl, downloadUrl: `${signedUrl}&download=${encodeURIComponent(file.name)}` };
}

/** Removes the app's copies of a Drive file that was deleted or replaced. */
export async function dropCopies(fileId: string) {
  const cached = (await copies.list(fileId)).data ?? [];
  if (cached.length) await copies.remove(cached.map((o) => `${fileId}/${o.name}`));
}
