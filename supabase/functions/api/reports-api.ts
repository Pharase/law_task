// Reports tab, "รายงานประจำเดือน": the files in a Google Drive folder, viewed and downloaded inside the app.
// Each Drive file is copied to the private `reports` bucket once per version (path = id/modifiedMs.pdf),
// so people always get the latest version without ever being sent to Google Drive.
import { latestPerKind } from "./reports.ts";
import { sheet } from "./sheet.ts";
import { db, HttpError, type Me, must } from "./shared.ts";

const reports = db.storage.from("reports");
type DriveFile = { id: string; name: string; modified: string };

async function listFiles(): Promise<{ files: DriveFile[]; folderUrl: string | null }> {
  const { files, folderUrl } = await sheet("listReports");
  return { files: (files as DriveFile[]).sort((a, b) => b.modified.localeCompare(a.modified)), folderUrl: folderUrl ?? null }; // newest first
}

const pdfName = (name: string) => name.replace(/\.pdf$/i, "") + ".pdf";

// deno-lint-ignore no-explicit-any
export async function memberReportActions(action: string, body: any, _me: Me): Promise<unknown> {
  switch (action) {
    case "listReports": {
      // the app shows the newest report of each kind (by file name); older ones are opened in the Drive folder (folderUrl)
      const { files, folderUrl } = await listFiles();
      const latest = latestPerKind(files);
      return { latest: latest.map(({ id, name, modified }) => ({ id, name, modified })), count: files.length, shown: latest.length, folderUrl };
    }

    case "reportUrl": {
      const file = (await listFiles()).files.find((f) => f.id === String(body.id ?? ""));
      if (!file) throw new HttpError(404, "report not found");
      const version = `${new Date(file.modified).getTime()}.pdf`;
      const path = `${file.id}/${version}`;
      // each step says what failed, so "view / download does not work" can be fixed from the message
      const step = <T>(what: string, r: { data: T; error: unknown }): T => {
        if (r.error) throw new HttpError(502, `เปิดรายงานไม่ได้ (${what}): ${(r.error as { message?: string }).message ?? r.error}`);
        return r.data;
      };
      const cached = step("storage list", await reports.list(file.id)) as { name: string }[];
      if (!cached.some((o) => o.name === version)) {
        // new or changed in Drive: export it (Google files become PDF) and cache this version
        const { base64 } = await sheet("reportFile", { id: file.id }, 60_000);
        if (!base64) throw new HttpError(502, "เปิดรายงานไม่ได้ (Drive export): the script returned no file — redeploy the script (New version)");
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        step("storage upload", await reports.upload(path, bytes, { contentType: "application/pdf", upsert: true }));
        const old = cached.filter((o) => o.name !== version).map((o) => `${file.id}/${o.name}`);
        if (old.length) await reports.remove(old); // older versions are no longer needed
      }
      const { signedUrl } = step("signed link", await reports.createSignedUrl(path, 3600)) as { signedUrl: string };
      return { previewUrl: signedUrl, downloadUrl: `${signedUrl}&download=${encodeURIComponent(pdfName(file.name))}` };
    }
  }
  return undefined;
}
