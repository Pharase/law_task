// Members page → ตั้งค่า: notice times, bubble pictures, and a "do the Sheet / Drive links still work" check.
import { TABS } from "./lien.ts";
import { ADMIN_HERO_URL, HERO_URL } from "./linebot.ts";
import { normalizeSettings, readSettings, type Settings } from "./settings.ts";
import { sheet } from "./sheet.ts";
import { db, HttpError, type Me, must } from "./shared.ts";

const KEY = "notify";
const images = db.storage.from("line-images");
const HERO_KIND = { task: "taskHero", admin: "adminHero" } as const;
const HERO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

/** Current settings; defaults when never saved or unreadable (a bad row must never stop notices). */
export async function loadSettings(): Promise<Settings> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) console.error("settings", error);
  return readSettings(data?.value);
}

async function save(input: unknown, me: Me): Promise<Settings> {
  let value: Settings;
  try { value = normalizeSettings(input, await loadSettings()); } catch (e) { throw new HttpError(400, (e as Error).message); }
  must(await db.from("app_settings").upsert({ key: KEY, value, updated_at: new Date().toISOString(), updated_by: me.line_user_id }));
  return value;
}

type Check = { name: string; ok: boolean; detail: string; url?: string | null };

/** Each link the app depends on, read for real; one failing never hides the others. */
async function checkLinks(): Promise<Check[]> {
  const count = (rows: unknown) => (Array.isArray(rows) ? rows.length : 0);
  const run = async (name: string, fn: () => Promise<Omit<Check, "name" | "ok">>): Promise<Check> => {
    try { return { name, ok: true, ...(await fn()) }; } catch (e) { return { name, ok: false, detail: (e as Error).message ?? String(e) }; }
  };
  return await Promise.all([
    run("Google Sheet งาน (Tasks / Sends / Buildings)", async () => {
      const { tabs } = await sheet("read", { tabs: ["Tasks", "Sends", "Buildings"] });
      return { detail: `งาน ${count(tabs.Tasks)} แถว · ส่งงาน ${count(tabs.Sends)} แถว · นิติ ${count(tabs.Buildings)} แถว` };
    }),
    run("Google Sheet ค้างค่าส่วนกลาง (Button E)", async () => {
      const { tabs } = await sheet("read", { tabs: Object.values(TABS) });
      return { detail: Object.values(TABS).map((t) => `${t} ${count(tabs[t])} แถว`).join(" · ") };
    }),
    run("Google Drive รายงานประจำเดือน", async () => {
      const { files, folderUrl } = await sheet("listReports", {}, 30_000);
      return { detail: `พบ ${count(files)} ไฟล์ในโฟลเดอร์`, url: folderUrl };
    }),
    run("Google Drive สำเนาไฟล์ส่งงาน", async () => {
      // the copy happens at send time; files still without a Drive link mean copying is failing
      const last = must(await db.from("files").select("backed_up_at, drive_url").not("drive_url", "is", null)
        .order("backed_up_at", { ascending: false }).limit(1))[0];
      const { count: waiting } = await db.from("files").select("id", { count: "exact", head: true })
        .is("backed_up_at", null).is("deleted_at", null).not("task_id", "is", null);
      if (waiting) throw new Error(`มี ${waiting} ไฟล์ยังไม่ได้คัดลอกไป Drive (ระบบจะลองใหม่ทุกคืน)`);
      return { detail: last ? `คัดลอกล่าสุด ${String(last.backed_up_at).slice(0, 10)} · กดเพื่อเปิดไฟล์ล่าสุด` : "ยังไม่มีไฟล์ส่งงาน", url: last?.drive_url };
    }),
  ]);
}

// deno-lint-ignore no-explicit-any
export async function adminSettingsActions(action: string, body: any, me: Me): Promise<unknown> {
  switch (action) {
    case "getSettings":
      return { settings: await loadSettings(), builtIn: { taskHero: HERO_URL, adminHero: ADMIN_HERO_URL } };

    case "saveSettings":
      return { settings: await save(body.settings, me) };

    case "uploadHero": {
      const field = HERO_KIND[body.kind as keyof typeof HERO_KIND];
      const file = body.file;
      if (!field) throw new HttpError(400, "kind must be task or admin");
      if (!(file instanceof File)) throw new HttpError(400, "no file");
      const ext = HERO_EXT[file.type];
      if (!ext) throw new HttpError(400, "รูปต้องเป็น JPG หรือ PNG");
      if (file.size > 1024 * 1024) throw new HttpError(400, "รูปใหญ่เกิน 1 MB");
      // new name every time: LINE caches pictures by URL; old bubbles keep their old picture
      const path = `${body.kind}-${Date.now()}.${ext}`;
      must(await images.upload(path, file, { contentType: file.type }));
      return { settings: await save({ [field]: images.getPublicUrl(path).data.publicUrl }, me) };
    }

    case "checkLinks":
      return { checks: await checkLinks() };
  }
  return undefined;
}
