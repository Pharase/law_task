// Daily LINE summary sender (spec "Notifications"). Public + idempotent: at most one run per Bangkok weekday after 09:00.
import { bangkokDate } from "./dates.ts";
import { adminDigest, approvedRecently, isWorkingHours, memberDigest, NEON, shouldRunDigest, splitActive, type T } from "./digest.ts";
import { type BubbleTask, linkMessage, MAX_TASKS_PER_PUSH, taskMessages } from "./linebot.ts";
import { cutoff } from "./retention.ts";
import { batch, loadSheet, type Step } from "./sheet.ts";
import { loadLine, loadSettings } from "./settings-api.ts";
import { db, HttpError, must } from "./shared.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function lineGet(path: string, token: string) {
  const r = await fetch(`https://api.line.me${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`LINE ${path} ${r.status}`);
  return await r.json();
}

/** Messages left this month; Infinity on unlimited plans. */
/** This month's push quota: limit (Infinity = no limit) and messages used so far. */
async function quotaInfo(token: string): Promise<{ limit: number; used: number }> {
  const [quota, used] = await Promise.all([lineGet("/v2/bot/message/quota", token), lineGet("/v2/bot/message/quota/consumption", token)]);
  return { limit: quota.type === "limited" ? quota.value : Infinity, used: used.totalUsage };
}
async function remainingQuota(token: string): Promise<number> {
  const { limit, used } = await quotaInfo(token);
  return limit - used;
}

/** One push (= 1 message of the monthly quota, however many bubbles it holds). null = sent, else the error. */
async function pushMessages(to: string, messages: unknown[], token: string): Promise<string | null> {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ to, messages }),
  });
  return r.ok ? null : `push ${r.status}: ${(await r.text()).slice(0, 200)}`;
}
const push = (to: string, text: string, link: string, token: string, hero?: string | null) =>
  pushMessages(to, [linkMessage(text, link, hero, undefined, NEON)], token);

const asT = (t: Row): T => ({ title: t.title, building: t.building, due: t.current_due_on });
// oldest assigned first, then the nearest due date (the same order as "ใกล้ครบกำหนด")
const byAssigned = (a: Row, b: Row) =>
  String(a.created_at).slice(0, 10).localeCompare(String(b.created_at).slice(0, 10)) || a.current_due_on.localeCompare(b.current_due_on);

export async function digest() {
  const now = new Date();
  const today = bangkokDate(now);
  const last = must(await db.from("notify_log").select("run_date").is("line_user_id", null)
    .order("run_date", { ascending: false }).limit(1))[0]?.run_date ?? null;
  const settings = await loadSettings();
  if (!shouldRunDigest(now, last, settings.digest)) return { skipped: "not now" };
  const { token, liffUrl: app } = await loadLine();
  if (!token) return { skipped: "no token" }; // not logged, so it runs as soon as the token is set
  // Read everything BEFORE claiming the day: if Google is down this throws and the next cron run retries.
  const people: Row[] = must(await db.from("profiles").select("line_user_id, role, staff_name, display_name").in("role", ["member", "admin"]));
  const sheet = await loadSheet();
  // Claim today's run; a concurrent call hits the unique index and stops here.
  const claim = await db.from("notify_log").insert({ run_date: today, line_user_id: null, ok: true });
  if (claim.error) return { skipped: "already running" };

  const open: Row[] = sheet.tasks.filter((t) => t.state !== "cancelled");
  const reviewed: Row[] = sheet.sends.filter((s) => s.outcome !== "pending" && !s.member_notified_at);
  const { count: backupDue } = await db.from("files").select("id", { count: "exact", head: true })
    .is("deleted_at", null).is("backed_up_at", null).lt("created_at", cutoff(now).toISOString());
  const taskById = new Map(open.map((t) => [t.id, t]));

  // Build every message first (admins first), then send while quota lasts.
  const outbox: { to: string; text: string; link: string; hero?: string | null; taskIds: number[]; sendIds: number[] }[] = [];
  const waiting = open.filter((t) => t.state === "submitted")
    .map((t) => ({ ...asT(t), owner: t.owner_name }));
  const members = people.filter((p) => p.role === "member");
  const admins = people.filter((p) => p.role === "admin");
  let remaining = await remainingQuota(token).catch(() => Infinity);
  const memberMsgs = members.map((p) => {
    const mine = open.filter((t) => t.owner === p.line_user_id);
    const active = mine.filter((t) => t.state === "on_process").sort(byAssigned);
    const sends = reviewed.filter((s) => taskById.get(s.task_id)?.owner === p.line_user_id);
    const newTasks = active.filter((t) => !t.member_notified_at);
    const activeIds = new Set(active.map((t) => t.id));
    // one entry per task (the latest send wins): sent back only while still in progress, approved only once it isn't
    const latest = (list: Row[]) => [...new Map(list.map((s) => [s.task_id, s])).values()];
    const back = latest(sends.filter((s) => s.outcome !== "approved" && activeIds.has(s.task_id)));
    const split = splitActive(active.map((t) => ({ ...asT(t), id: t.id, assigned: String(t.created_at) })),
      new Set(newTasks.map((t) => t.id)), new Set(back.map((s) => s.task_id)), today);
    const text = memberDigest({
      ...split,
      sentBack: back.map((s) => ({
        ...asT(taskById.get(s.task_id)!), reason: s.outcome === "fix" ? "มีปรับแก้" : "กดผิด", note: s.fix_note,
      })),
      approved: latest(approvedRecently(sends, today).filter((s) => !activeIds.has(s.task_id))) // yesterday's only, never a long backlog
        .map((s) => asT(taskById.get(s.task_id)!)),
    });
    return text && { to: p.line_user_id, text, link: app, taskIds: newTasks.map((t) => t.id), sendIds: sends.map((s) => s.id) };
  }).filter(Boolean) as typeof outbox;
  const adminText = adminDigest({ waiting, backupDue: backupDue ?? 0, quotaLow: remaining < admins.length + memberMsgs.length });
  if (adminText) for (const a of admins) outbox.push({ to: a.line_user_id, text: adminText, link: `${app}/admin/tasks.html`, hero: settings.adminHero, taskIds: [], sendIds: [] });
  outbox.push(...memberMsgs);

  let sent = 0, quotaSkipped = 0;
  for (const m of outbox) {
    if (remaining <= 0) {
      quotaSkipped++;
      await db.from("notify_log").insert({ run_date: today, line_user_id: m.to, ok: false, error: "quota" });
      continue;
    }
    const error = await push(m.to, m.text, m.link, token, m.hero).catch((e) => String(e));
    await db.from("notify_log").insert({ run_date: today, line_user_id: m.to, ok: !error, error });
    if (error) continue; // not marked, so tomorrow's summary repeats it
    sent++;
    remaining--;
    const at = new Date().toISOString();
    const marks: Step[] = [
      ...m.taskIds.map((id) => ({ op: "update" as const, tab: "Tasks", id, patch: { member_notified_at: at } })),
      ...m.sendIds.map((id) => ({ op: "update" as const, tab: "Sends", id, patch: { member_notified_at: at } })),
    ];
    if (marks.length) await batch(marks).catch((e) => console.error("digest marks", e)); // unmarked = repeated tomorrow
  }
  return { sent, quotaSkipped, recipients: outbox.length };
}

/**
 * New-task bubbles (with the ส่งงาน button): one push per person, only 08:30–17:30 Bangkok.
 * Returns the ids of the tasks whose owner got them (the caller marks them notified, so neither the
 * catch-up run nor the morning summary repeats them). Outside working hours, without a token, or when
 * LINE refuses (e.g. monthly quota used up), nothing is marked: pendingNotices sends them later.
 */
export async function notifyNewTasks(groups: { to: string; tasks: BubbleTask[] }[], anyTime = false): Promise<number[]> {
  const { token, liffUrl: app } = await loadLine();
  if (!token || !groups.length) return [];
  const settings = await loadSettings();
  if (!anyTime && !isWorkingHours(new Date(), settings.instant)) return []; // anyTime: an admin's resend goes now
  const today = bangkokDate(new Date());
  const done: number[] = [];
  for (const g of groups) {
    const tasks = g.tasks.slice(0, MAX_TASKS_PER_PUSH); // the rest stay unmarked and go in the next catch-up run
    const error = await pushMessages(g.to, taskMessages(tasks, settings.taskHero, app), token).catch((e) => String(e));
    await db.from("notify_log").insert({ run_date: today, line_user_id: g.to, ok: !error, error: error ? "instant: " + error : null });
    if (!error) done.push(...tasks.map((t) => t.id));
  }
  return done;
}

/**
 * Invoice status notice to a building's หัวหน้าทีม, sent right away (an admin just saved it). The button opens the
 * invoice in the app. Returns null when sent, else why not (the save itself still counts).
 */
export async function notifyInvoice(to: string[], text: string, invoiceId: number): Promise<string | null> {
  const { token, liffUrl: app } = await loadLine();
  if (!token) return "ยังไม่ได้ตั้ง Channel access token (ตั้งค่า → Linkage)";
  if (!to.length) return "ไม่พบบัญชี LINE ของหัวหน้าทีมของนิติบุคคลนี้";
  const message = linkMessage(text, `${app}/Button%20F/?invoice=${invoiceId}`, null, "กดเพื่อดูรายละเอียด");
  const today = bangkokDate(new Date());
  const errors: string[] = [];
  for (const id of to) {
    const error = await pushMessages(id, [message], token).catch((e) => String(e));
    await db.from("notify_log").insert({ run_date: today, line_user_id: id, ok: !error, error: error ? "invoice: " + error : null });
    if (error) errors.push(error);
  }
  return errors.length ? errors.join(" · ") : null;
}

const CATCH_UP_DAYS = 4; // a task assigned Friday evening still gets its bubble on Monday; older unsent ones are left to the daily summary

/**
 * Catch-up for tasks assigned outside working hours (or when LINE failed): cron calls it every 30 minutes;
 * during 08:30–17:30 it sends the bubbles of every on-process task assigned in the last 4 days that nobody
 * was told about yet. Public + safe: it only sends what is due and marks it, so a second call sends nothing.
 */
export async function pendingNotices() {
  if (!isWorkingHours(new Date(), (await loadSettings()).instant)) return { skipped: "outside working hours" };
  const since = bangkokDate(new Date(Date.now() - CATCH_UP_DAYS * 86400_000));
  const { tasks } = await loadSheet();
  // created_at can come back as a date only (the sheet formats it), so compare dates
  const waiting = tasks.filter((t) => t.state === "on_process" && !t.member_notified_at && t.created_at.slice(0, 10) >= since)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.current_due_on.localeCompare(b.current_due_on));
  if (!waiting.length) return { sent: 0 };
  const byOwner = new Map<string, BubbleTask[]>();
  for (const t of waiting) {
    byOwner.set(t.owner, [...(byOwner.get(t.owner) ?? []), { id: t.id, title: t.title, building: t.building, details: t.details, due: t.current_due_on }]);
  }
  // shortcut: an assignment landing during this run could get its bubble twice (instant + catch-up); seconds-wide window, fine for a small team
  const sent = await notifyNewTasks([...byOwner].map(([to, list]) => ({ to, tasks: list })));
  if (sent.length) {
    const at = new Date().toISOString();
    await batch(sent.map((id) => ({ op: "update" as const, tab: "Tasks", id, patch: { member_notified_at: at } })));
  }
  return { sent: sent.length, waiting: waiting.length };
}

/** Reply to a LINE webhook event (free: replies don't use the monthly push quota). */
export async function replyMessages(replyToken: string, messages: unknown[], token: string) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!r.ok) console.error("LINE reply", r.status, (await r.text()).slice(0, 200));
}

/** Sample of every pushed message type (made-up data), in one push: task bubble, member summary, admin summary. */
function sampleMessages(heroes: { taskHero: string | null; adminHero: string | null }, app: string) {
  const today = bangkokDate(new Date());
  const t = { title: "ตัวอย่าง: ร่างหนังสือทวงถาม", building: "นิติบุคคลตัวอย่าง", due: today };
  return [
    ...taskMessages([{ id: 0, title: t.title, building: t.building, details: "ข้อความทดสอบ ไม่ใช่งานจริง", due: today }], heroes.taskHero, app),
    linkMessage(memberDigest({
      newTasks: [t], dueSoon: [{ ...t, assigned: today, daysLeft: 0 }], overdue: [t],
      sentBack: [{ ...t, reason: "มีปรับแก้", note: "ตัวอย่างสิ่งที่ต้องแก้" }], approved: [t],
    })!, app, null, undefined, NEON),
    linkMessage(adminDigest({ waiting: [{ ...t, owner: "พนักงานตัวอย่าง" }], backupDue: 1, quotaLow: true })!, `${app}/admin/tasks.html`, heroes.adminHero, undefined, NEON),
  ];
}

/**
 * Admin tests, only to the admin's own LINE, any time. testLine: one short message. testLineAll: a sample of every
 * message type (still 1 push of the monthly quota). Says exactly what went wrong if it fails.
 */
// deno-lint-ignore no-explicit-any
export async function adminNotifyActions(action: string, body: any, me: { line_user_id: string; role: string }): Promise<unknown> {
  if (!["testLine", "testLineAll", "lineQuota", "broadcast"].includes(action)) return undefined;
  const { token, liffUrl: app } = await loadLine();
  if (!token) return { ok: false, error: "ยังไม่ได้ตั้ง Channel access token (ตั้งค่า → Linkage)" };
  if (action === "lineQuota") {
    // members page badge; null limit = no monthly limit (JSON has no Infinity)
    const { limit, used } = await quotaInfo(token);
    return { ok: true, limit: limit === Infinity ? null : limit, used, left: limit === Infinity ? null : limit - used };
  }
  if (action === "broadcast") return await broadcast(body, me, token, app);
  const quotaLeft = await remainingQuota(token).catch(() => null);
  const messages = action === "testLineAll" ? sampleMessages(await loadSettings(), app)
    : [linkMessage("✅ ทดสอบการแจ้งเตือนจาก Loliy_Pass\nถ้าเห็นข้อความนี้ แปลว่าการแจ้งเตือนทาง LINE ใช้งานได้", app)];
  const error = await pushMessages(me.line_user_id, messages, token).catch((e) => String(e));
  await db.from("notify_log").insert({ run_date: bangkokDate(new Date()), line_user_id: me.line_user_id, ok: !error, error: error ? "test: " + error : null });
  return { ok: !error, error, quotaLeft: quotaLeft === Infinity ? "unlimited" : quotaLeft };
}

const BROADCAST_ROLES: Record<string, string[]> = { all: ["member", "admin"], member: ["member"], admin: ["admin"] };

/**
 * Admin announcement to the team's own LINE accounts (approved people only, not every friend of the OA).
 * Costs 1 message of the monthly quota per person, so it refuses up front when the quota can't cover everyone.
 */
// deno-lint-ignore no-explicit-any
async function broadcast(body: any, me: { line_user_id: string }, token: string, app: string) {
  const text = String(body.text ?? "").trim();
  const roles = BROADCAST_ROLES[body.to];
  if (!text || text.length > 2000) throw new HttpError(400, "ข้อความต้องมี 1–2000 ตัวอักษร");
  if (!roles) throw new HttpError(400, "to must be all, member or admin");
  const ids: string[] = must(await db.from("profiles").select("line_user_id").in("role", roles)).map((p: { line_user_id: string }) => p.line_user_id);
  if (!ids.length) return { ok: false, error: "ไม่มีผู้รับ" };
  const left = await remainingQuota(token).catch(() => Infinity);
  if (left < ids.length) return { ok: false, error: `โควตาเหลือ ${left} แต่มีผู้รับ ${ids.length} คน` };
  const today = bangkokDate(new Date());
  let sent = 0, error: string | null = null;
  for (let i = 0; i < ids.length; i += 500) { // LINE multicast: 500 people per call
    const to = ids.slice(i, i + 500);
    const r = await fetch("https://api.line.me/v2/bot/message/multicast", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ to, messages: [linkMessage("📢 ประกาศ\n\n" + text, app)] }),
    }).catch((e) => e as Error);
    error = r instanceof Error ? String(r) : r.ok ? null : `multicast ${r.status}: ${(await r.text()).slice(0, 200)}`;
    if (error) break;
    sent += to.length;
  }
  await db.from("notify_log").insert({ run_date: today, line_user_id: me.line_user_id, ok: !error, error: `broadcast to ${sent}/${ids.length}` + (error ? ": " + error : "") });
  return { ok: !error, error, sent, total: ids.length };
}
