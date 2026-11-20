// Daily LINE summary text (spec "Notifications"): one message per person per weekday, null when there's nothing to say.
import { bangkokDate, daysBetween } from "./dates.ts";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";

export type T = { title: string; building: string; due: string };
export type Soon = T & { assigned: string; daysLeft: number };
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
  newTasks: T[]; dueSoon: Soon[]; overdue: T[];
  sentBack: (T & { note: string | null; reason: string })[]; approved: T[];
}): string | null {
  const parts = [
    section("📌 งานใหม่", x.newTasks.map(line)),
    section("⏳ ใกล้ครบกำหนด (ภายใน 3 วัน) · ยังไม่ส่ง", x.dueSoon.map((t) => `${line(t)} · ${t.daysLeft ? `อีก ${t.daysLeft} วัน` : "วันนี้"}`)),
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
  return parts.length ? ["สรุปสิ่งที่ต้องทำ", ...parts].join("\n\n") : null;
}

/** Bangkok weekday (0 = Sunday) and "HH:MM" right now. */
function bkkNow(now: Date): { day: number; hm: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hm: `${p.hour}:${p.minute}` };
}

/** Runs at most once per Bangkok day, on a chosen weekday, at or after the chosen time (default 09:00 Mon–Fri). */
export function shouldRunDigest(now: Date, lastRunDate: string | null, d: Settings["digest"] = DEFAULT_SETTINGS.digest): boolean {
  const { day, hm } = bkkNow(now);
  return d.on && d.days.includes(day) && hm >= d.time && lastRunDate !== bangkokDate(now);
}

/** New-task bubbles: any time when the limit switch is off; else only inside the window (default 08:30–17:30 every day), pendingNotices sends the rest once it opens. */
export function isWorkingHours(now: Date, w: Settings["instant"] = DEFAULT_SETTINGS.instant): boolean {
  const { day, hm } = bkkNow(now);
  // start = end: all day; end before start: the window runs past midnight (days = the day it is now)
  const inside = w.start === w.end || (w.start < w.end ? hm >= w.start && hm < w.end : hm >= w.start || hm < w.end);
  return !w.on || (w.days.includes(day) && inside);
}

const SOON_DAYS = 3;

/** Not-yet-sent tasks due today up to 3 days ahead: oldest assigned first, then the nearest due date. */
export function dueSoon<X extends T & { assigned: string }>(tasks: X[], today: string): (X & { daysLeft: number })[] {
  return tasks.map((t) => ({ ...t, daysLeft: daysBetween(today, t.due) }))
    .filter((t) => t.daysLeft >= 0 && t.daysLeft <= SOON_DAYS)
    .sort((a, b) => a.assigned.slice(0, 10).localeCompare(b.assigned.slice(0, 10)) || a.due.localeCompare(b.due));
}

/**
 * In-progress tasks split so each one lands in exactly one summary section, first match wins:
 * sent back (backIds, shown by the caller with its note) → overdue → due soon → new.
 */
export function splitActive<X extends T & { id: number; assigned: string }>(
  active: X[], newIds: Set<number>, backIds: Set<number>, today: string,
) {
  const free = active.filter((t) => !backIds.has(t.id));
  const overdue = free.filter((t) => t.due < today);
  const soon = dueSoon(free, today);
  const taken = new Set([...overdue, ...soon].map((t) => t.id));
  return { overdue, dueSoon: soon, newTasks: free.filter((t) => newIds.has(t.id) && !taken.has(t.id)) };
}

/**
 * "✅ อนุมัติแล้ว" in the morning summary: only approvals from yesterday (and this morning before the summary), by the
 * Bangkok date of reviewed_at, so a missed or old approval never turns into a long list. Blank reviewed_at = left out.
 */
// deno-lint-ignore no-explicit-any
export function approvedRecently<S extends Record<string, any>>(sends: S[], today: string): S[] {
  return sends.filter((s) => {
    if (s.outcome !== "approved" || !s.reviewed_at) return false;
    const at = new Date(s.reviewed_at);
    return !isNaN(at.getTime()) && daysBetween(bangkokDate(at), today) <= 1;
  });
}
