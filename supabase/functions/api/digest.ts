// Daily LINE summary text (spec "Notifications"): one message per person per weekday, null when there's nothing to say.
import { bangkokDate } from "./dates.ts";

export type T = { title: string; building: string; due: string };
const MAX_ITEMS = 10;

const thDate = (s: string) =>
  new Date(s + "T00:00:00+07:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });

function section(header: string, items: string[]): string | null {
  if (!items.length) return null;
  const shown = items.slice(0, MAX_ITEMS).map((x) => "• " + x);
  if (items.length > MAX_ITEMS) shown.push(`+${items.length - MAX_ITEMS} รายการ`);
  return [header, ...shown].join("\n");
}

const line = (t: T) => `${t.title} (${t.building}) กำหนด ${thDate(t.due)}`;

export function memberDigest(x: {
  newTasks: T[]; dueToday: T[]; overdue: T[];
  sentBack: (T & { note: string | null; reason: string })[]; approved: T[];
}): string | null {
  const parts = [
    section("📌 งานใหม่", x.newTasks.map(line)),
    section("⏰ ครบกำหนดวันนี้", x.dueToday.map(line)),
    section("‼️ เลยกำหนด", x.overdue.map(line)),
    section("↩️ ถูกส่งกลับ", x.sentBack.map((t) => `${line(t)} · ${t.reason}${t.note ? `: ${t.note}` : ""}`)),
    section("✅ อนุมัติแล้ว", x.approved.map((t) => `${t.title} (${t.building})`)),
  ].filter(Boolean);
  return parts.length ? ["สรุปงานวันนี้", ...parts].join("\n\n") : null;
}

export function adminDigest(x: { waiting: (T & { owner: string })[]; backupDue: number; quotaLow: boolean }): string | null {
  const parts = [
    section(`📥 งานรอตรวจ ${x.waiting.length} งาน`, x.waiting.map((t) => `${t.title} · ${t.owner} (${t.building})`)),
    x.backupDue > 0 ? `🗄️ มี ${x.backupDue} ไฟล์อายุเกิน 1 ปีรอดาวน์โหลดสำรองก่อนลบ` : null,
    x.quotaLow ? "⚠️ โควตา LINE ใกล้หมด สมาชิกอาจไม่ได้รับสรุปวันนี้" : null,
  ].filter(Boolean);
  return parts.length ? ["สรุปสำหรับแอดมิน", ...parts].join("\n\n") : null;
}

const bkkParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", weekday: "short", hour: "numeric", hourCycle: "h23" });

/** Runs at most once per Bangkok weekday, at or after 09:00 Bangkok. */
export function shouldRunDigest(now: Date, lastRunDate: string | null): boolean {
  const p = Object.fromEntries(bkkParts.formatToParts(now).map((x) => [x.type, x.value]));
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  if (Number(p.hour) < 9) return false;
  return lastRunDate !== bangkokDate(now);
}
