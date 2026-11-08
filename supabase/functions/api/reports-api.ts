// Reports tab, "รายงานประจำเดือน": the files in a Google Drive folder, viewed and downloaded inside the app.
// Each Drive file is copied to the private `reports` bucket once per version (path = id/modifiedMs.pdf),
// so people always get the latest version without ever being sent to Google Drive.
import { sheet } from "./sheet.ts";
import { db, HttpError, type Me, must } from "./shared.ts";

const reports = db.storage.from("reports");
type DriveFile = { id: string; name: string; modified: string };

async function listFiles(): Promise<DriveFile[]> {
  const { files } = await sheet("listReports");
  return (files as DriveFile[]).sort((a, b) => b.modified.localeCompare(a.modified)); // newest first
}

const pdfName = (name: string) => name.replace(/\.pdf$/i, "") + ".pdf";

// deno-lint-ignore no-explicit-any
export async function memberReportActions(action: string, body: any, _me: Me): Promise<unknown> {
  switch (action) {
    case "listReports":
      return (await listFiles()).map(({ id, name, modified }) => ({ id, name, modified }));

    case "reportUrl": {
      const file = (await listFiles()).find((f) => f.id === String(body.id ?? ""));
      if (!file) throw new HttpError(404, "report not found");
      const version = `${new Date(file.modified).getTime()}.pdf`;
      const path = `${file.id}/${version}`;
      const cached: { name: string }[] = must(await reports.list(file.id));
      if (!cached.some((o) => o.name === version)) {
        // new or changed in Drive: export it (Google files become PDF) and cache this version
        const { base64 } = await sheet("reportFile", { id: file.id }, 60_000);
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        must(await reports.upload(path, bytes, { contentType: "application/pdf", upsert: true }));
        const old = cached.filter((o) => o.name !== version).map((o) => `${file.id}/${o.name}`);
        if (old.length) await reports.remove(old); // older versions are no longer needed
      }
      const { signedUrl } = must(await reports.createSignedUrl(path, 3600));
      return { previewUrl: signedUrl, downloadUrl: `${signedUrl}&download=${encodeURIComponent(pdfName(file.name))}` };
    }
  }
  return undefined;
}
