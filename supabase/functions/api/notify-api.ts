// Daily LINE summary sender (spec "Notifications"). Public + idempotent: at most one run per Bangkok weekday after 09:00.
import { bangkokDate } from "./dates.ts";
import { adminDigest, dueSoon, isWorkingHours, memberDigest, shouldRunDigest, type T } from "./digest.ts";
import { type BubbleTask, MAX_TASKS_PER_PUSH, taskMessages } from "./linebot.ts";
import { cutoff } from "./retention.ts";
import { batch, loadSheet, type Step } from "./sheet.ts";
import { db, must } from "./shared.ts";

const LIFF_URL = "https://liff.line.me/2012450429-k3WOCwtO";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function lineGet(path: string, token: string) {
  const r = await fetch(`https://api.line.me${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`LINE ${path} ${r.status}`);
  return await r.json();
}

/** Messages left this month; Infinity on unlimited plans. */
async function remainingQuota(token: string): Promise<number> {
  const quota = await lineGet("/v2/bot/message/quota", token);
  if (quota.type !== "limited") return Infinity;
  const used = await lineGet("/v2/bot/message/quota/consumption", token);
  return quota.value - used.totalUsage;
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
const push = (to: string, text: string, link: string, token: string) =>
  pushMessages(to, [{ type: "text", text: `${text}\n\n${link}`.slice(0, 5000) }], token);

const asT = (t: Row): T => ({ title: t.title, building: t.building, due: t.current_due_on });
// oldest assigned first, then the nearest due date (the same order as "ใกล้ครบกำหนด")
const byAssigned = (a: Row, b: Row) =>
  String(a.created_at).slice(0, 10).localeCompare(String(b.created_at).slice(0, 10)) || a.current_due_on.localeCompare(b.current_due_on);

export async function digest() {
  const now = new Date();
  const today = bangkokDate(now);
  const last = must(await db.from("notify_log").select("run_date").is("line_user_id", null)
    .order("run_date", { ascending: false }).limit(1))[0]?.run_date ?? null;
  if (!shouldRunDigest(now, last)) return { skipped: "not now" };
  const token = Deno.env.get("LINE_MESSAGING_TOKEN");
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
  const outbox: { to: string; text: string; link: string; taskIds: number[]; sendIds: number[] }[] = [];
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
    const text = memberDigest({
      newTasks: newTasks.map(asT),
      dueSoon: dueSoon(active.map((t) => ({ ...asT(t), assigned: String(t.created_at) })), today),
      overdue: active.filter((t) => t.current_due_on < today).map(asT),
      sentBack: sends.filter((s) => s.outcome !== "approved").map((s) => ({
        ...asT(taskById.get(s.task_id)!), reason: s.outcome === "fix" ? "มีปรับแก้" : "กดผิด", note: s.fix_note,
      })),
      approved: sends.filter((s) => s.outcome === "approved").map((s) => asT(taskById.get(s.task_id)!)),
    });
    return text && { to: p.line_user_id, text, link: LIFF_URL, taskIds: newTasks.map((t) => t.id), sendIds: sends.map((s) => s.id) };
  }).filter(Boolean) as typeof outbox;
  const adminText = adminDigest({ waiting, backupDue: backupDue ?? 0, quotaLow: remaining < admins.length + memberMsgs.length });
  if (adminText) for (const a of admins) outbox.push({ to: a.line_user_id, text: adminText, link: `${LIFF_URL}/admin/tasks.html`, taskIds: [], sendIds: [] });
  outbox.push(...memberMsgs);

  let sent = 0, quotaSkipped = 0;
  for (const m of outbox) {
    if (remaining <= 0) {
      quotaSkipped++;
      await db.from("notify_log").insert({ run_date: today, line_user_id: m.to, ok: false, error: "quota" });
      continue;
    }
    const error = await push(m.to, m.text, m.link, token).catch((e) => String(e));
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
export async function notifyNewTasks(groups: { to: string; tasks: BubbleTask[] }[]): Promise<number[]> {
  const token = Deno.env.get("LINE_MESSAGING_TOKEN");
  if (!token || !groups.length || !isWorkingHours(new Date())) return [];
  const today = bangkokDate(new Date());
  const done: number[] = [];
  for (const g of groups) {
    const tasks = g.tasks.slice(0, MAX_TASKS_PER_PUSH); // the rest stay unmarked and go in the next catch-up run
    const error = await pushMessages(g.to, taskMessages(tasks), token).catch((e) => String(e));
    await db.from("notify_log").insert({ run_date: today, line_user_id: g.to, ok: !error, error: error ? "instant: " + error : null });
    if (!error) done.push(...tasks.map((t) => t.id));
  }
  return done;
}

const CATCH_UP_DAYS = 4; // a task assigned Friday evening still gets its bubble on Monday; older unsent ones are left to the daily summary

/**
 * Catch-up for tasks assigned outside working hours (or when LINE failed): cron calls it every 30 minutes;
 * during 08:30–17:30 it sends the bubbles of every on-process task assigned in the last 4 days that nobody
 * was told about yet. Public + safe: it only sends what is due and marks it, so a second call sends nothing.
 */
export async function pendingNotices() {
  if (!isWorkingHours(new Date())) return { skipped: "outside working hours" };
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
export async function replyText(replyToken: string, text: string, token: string) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
  });
  if (!r.ok) console.error("LINE reply", r.status, (await r.text()).slice(0, 200));
}

/** Admin "test LINE to me": one message to the admin's own LINE, any time. Says exactly what went wrong if it fails. */
// deno-lint-ignore no-explicit-any
export async function adminNotifyActions(action: string, _body: any, me: { line_user_id: string; role: string }): Promise<unknown> {
  if (action !== "testLine") return undefined;
  const token = Deno.env.get("LINE_MESSAGING_TOKEN");
  if (!token) return { ok: false, error: "LINE_MESSAGING_TOKEN is not set in Supabase (Edge Functions → Secrets)" };
  const quotaLeft = await remainingQuota(token).catch(() => null);
  const error = await push(me.line_user_id, "✅ ทดสอบการแจ้งเตือนจาก law_task\nถ้าเห็นข้อความนี้ แปลว่าการแจ้งเตือนทาง LINE ใช้งานได้", LIFF_URL, token)
    .catch((e) => String(e));
  await db.from("notify_log").insert({ run_date: bangkokDate(new Date()), line_user_id: me.line_user_id, ok: !error, error: error ? "test: " + error : null });
  return { ok: !error, error, quotaLeft: quotaLeft === Infinity ? "unlimited" : quotaLeft };
}
