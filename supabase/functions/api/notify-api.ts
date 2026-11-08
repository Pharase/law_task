// Daily LINE summary sender (spec "Notifications"). Public + idempotent: at most one run per Bangkok weekday after 09:00.
import { bangkokDate } from "./dates.ts";
import { adminDigest, memberDigest, shouldRunDigest, type T } from "./digest.ts";
import { cutoff } from "./retention.ts";
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

async function push(to: string, text: string, link: string, token: string): Promise<string | null> {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ to, messages: [{ type: "text", text: `${text}\n\n${link}`.slice(0, 5000) }] }),
  });
  return r.ok ? null : `push ${r.status}: ${(await r.text()).slice(0, 200)}`;
}

const asT = (t: Row): T => ({ title: t.title, building: t.buildings?.name ?? "", due: t.current_due_on });

export async function digest() {
  const now = new Date();
  const today = bangkokDate(now);
  const last = must(await db.from("notify_log").select("run_date").is("line_user_id", null)
    .order("run_date", { ascending: false }).limit(1))[0]?.run_date ?? null;
  if (!shouldRunDigest(now, last)) return { skipped: "not now" };
  const token = Deno.env.get("LINE_MESSAGING_TOKEN");
  if (!token) return { skipped: "no token" }; // not logged, so it runs as soon as the token is set
  // Claim today's run; a concurrent call hits the unique index and stops here.
  const claim = await db.from("notify_log").insert({ run_date: today, line_user_id: null, ok: true });
  if (claim.error) return { skipped: "already running" };

  const people: Row[] = must(await db.from("profiles").select("line_user_id, role, staff_name, display_name").in("role", ["member", "admin"]));
  const open: Row[] = must(await db.from("tasks")
    .select("id, title, owner, state, current_due_on, member_notified_at, buildings(name), owner_profile:profiles!tasks_owner_fkey(staff_name, display_name)")
    .in("state", ["on_process", "submitted", "approved"]));
  const reviewed: Row[] = must(await db.from("task_sends").select("id, task_id, outcome, fix_note")
    .in("outcome", ["fix", "void", "approved"]).is("member_notified_at", null));
  const { count: backupDue } = await db.from("files").select("id", { count: "exact", head: true })
    .is("deleted_at", null).is("backed_up_at", null).lt("created_at", cutoff(now).toISOString());
  const taskById = new Map(open.map((t) => [t.id, t]));

  // Build every message first (admins first), then send while quota lasts.
  const outbox: { to: string; text: string; link: string; taskIds: number[]; sendIds: number[] }[] = [];
  const waiting = open.filter((t) => t.state === "submitted")
    .map((t) => ({ ...asT(t), owner: t.owner_profile?.staff_name || t.owner_profile?.display_name || "" }));
  const members = people.filter((p) => p.role === "member");
  const admins = people.filter((p) => p.role === "admin");
  let remaining = await remainingQuota(token).catch(() => Infinity);
  const memberMsgs = members.map((p) => {
    const mine = open.filter((t) => t.owner === p.line_user_id);
    const active = mine.filter((t) => t.state === "on_process");
    const sends = reviewed.filter((s) => taskById.get(s.task_id)?.owner === p.line_user_id);
    const newTasks = active.filter((t) => !t.member_notified_at);
    const text = memberDigest({
      newTasks: newTasks.map(asT),
      dueToday: active.filter((t) => t.current_due_on === today).map(asT),
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
    if (m.taskIds.length) await db.from("tasks").update({ member_notified_at: at }).in("id", m.taskIds);
    if (m.sendIds.length) await db.from("task_sends").update({ member_notified_at: at }).in("id", m.sendIds);
  }
  return { sent, quotaSkipped, recipients: outbox.length };
}
