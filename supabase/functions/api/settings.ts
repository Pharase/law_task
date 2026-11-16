// Admin settings (members page → ตั้งค่า): when LINE notices go out and which pictures the bubbles show.
// Pure: no Deno or npm imports, so node tests run it. Stored as one jsonb row (app_settings.key = 'notify').

/** Days are JS weekdays: 0 = Sunday … 6 = Saturday. Times are "HH:MM" Bangkok. */
export type Settings = {
  instant: { on: boolean; start: string; end: string; days: number[] }; // new-task bubbles
  digest: { on: boolean; time: string; days: number[] };                // daily สรุปงานวันนี้ / สรุปสิ่งที่ต้องทำ
  taskHero: string | null;  // picture on new-task bubbles; null = the built-in one
  adminHero: string | null; // picture on the admin summary; null = the built-in one
};

// The behaviour before settings existed: bubbles 08:30–17:30 every day, summary 09:00 Mon–Fri.
export const DEFAULT_SETTINGS: Settings = {
  instant: { on: true, start: "08:30", end: "17:30", days: [0, 1, 2, 3, 4, 5, 6] },
  digest: { on: true, time: "09:00", days: [1, 2, 3, 4, 5] },
  taskHero: null,
  adminHero: null,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function time(v: unknown, what: string): string {
  if (typeof v !== "string" || !TIME.test(v)) throw new Error(`${what}: ต้องเป็นเวลา HH:MM`);
  return v;
}
function days(v: unknown, what: string): number[] {
  if (!Array.isArray(v) || v.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error(`${what}: วันไม่ถูกต้อง`);
  return [...new Set(v as number[])].sort();
}
function url(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^https:\/\/\S+$/.test(v) || v.length > 1000) throw new Error("รูปภาพต้องเป็นลิงก์ https");
  return v;
}

/** Checks an admin's edit (throws a Thai message on bad input); missing parts keep `base`. */
// deno-lint-ignore no-explicit-any
export function normalizeSettings(input: any, base: Settings = DEFAULT_SETTINGS): Settings {
  const i = { ...base.instant, ...(input?.instant ?? {}) }, d = { ...base.digest, ...(input?.digest ?? {}) };
  const out: Settings = {
    instant: { on: Boolean(i.on), start: time(i.start, "เริ่มแจ้งงานใหม่"), end: time(i.end, "หยุดแจ้งงานใหม่"), days: days(i.days, "วันแจ้งงานใหม่") },
    digest: { on: Boolean(d.on), time: time(d.time, "เวลาสรุปงาน"), days: days(d.days, "วันสรุปงาน") },
    taskHero: url(input && "taskHero" in input ? input.taskHero : base.taskHero),
    adminHero: url(input && "adminHero" in input ? input.adminHero : base.adminHero),
  };
  if (out.instant.start >= out.instant.end) throw new Error("เวลาเริ่มแจ้งงานใหม่ต้องก่อนเวลาหยุด");
  return out;
}

/** Stored value -> Settings; anything unreadable falls back to the defaults (a bad row must never stop notices). */
export function readSettings(stored: unknown): Settings {
  try { return normalizeSettings(stored ?? {}); } catch { return DEFAULT_SETTINGS; }
}
