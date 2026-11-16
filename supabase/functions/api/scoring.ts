// PROVISIONAL scoring (spec "Performance"): change rules only here.
// Mirrors the old sheet: filter_task J (on time), K (accuracy), L (task); Team_summary O/P (average, 1–5 scale).
import { daysBetween } from "./dates.ts";

export type Send = { sentOn: string; dueOn: string; outcome: "pending" | "approved" | "fix" | "void" };
// lateOnly (0–10): a late task the admin has not approved yet; it counts in คะแนนตรงเวลา only, never in the tag scores
export type ScoredTask = { owner: string; tags: string[]; sends: Send[]; lateOnly?: number };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 10 when on time, minus 1 per 3 days late, never below 0. No rounding. */
export function dayScore(sentOn: string, dueOn: string): number {
  const late = daysBetween(dueOn, sentOn);
  return late <= 0 ? 10 : Math.max(0, 10 - late / 3);
}

/** null unless the task's last real (non-void) send was approved. */
export function taskScore(sends: Send[]): { onTime: number; accuracy: number; task: number } | null {
  const kept = sends.filter((s) => s.outcome !== "void"); // กดผิด sends never count
  const last = kept.at(-1);
  if (!last || last.outcome !== "approved") return null;
  const latestDue = kept.map((s) => s.dueOn).sort().at(-1)!;
  const onTime = dayScore(last.sentOn, latestDue);
  const accuracy = mean(kept.map((s) => dayScore(s.sentOn, s.dueOn)));
  return { onTime, accuracy, task: (onTime + accuracy) / 2 };
}

/**
 * How a task counts in the period from..to (YYYY-MM-DD; today caps an unfinished period):
 * - "full": approved inside the period -> on time + tag scores, from its real dates.
 * - { lateOnly }: assigned BEFORE the period, still not approved by its end, and late by then (sent after the
 *   due date, or not sent and the due date passed) -> คะแนนตรงเวลา only. It counts again in each later period until approved.
 * - null: not counted (cancelled, approved in another period, assigned in this period and not done yet, or not late).
 */
export function periodCount(
  t: { state: string; createdOn: string; currentDue: string; approvedOn: string | null; sends: Send[] },
  from: string, to: string, today: string,
): "full" | { lateOnly: number } | null {
  if (t.state === "cancelled") return null;
  if (t.approvedOn && t.approvedOn >= from && t.approvedOn <= to) return "full";
  if (t.approvedOn && t.approvedOn < from) return null;
  const asOf = to < today ? to : today;
  if (t.createdOn >= from || asOf < from) return null;
  const last = t.sends.filter((s) => s.outcome !== "void" && s.sentOn <= asOf).at(-1);
  // delivered and waiting for review (or approved later): judged by that send; otherwise not delivered as of asOf
  // shortcut: a fix given after asOf still uses today's due date; only matters when re-scoring an old period
  const delivered = last && (last.outcome === "pending" || last.outcome === "approved");
  const sentOn = delivered ? last.sentOn : asOf, due = delivered ? last.dueOn : t.currentDue;
  return sentOn > due ? { lateOnly: dayScore(sentOn, due) } : null;
}

/**
 * Per owner (0–1, i.e. score / 10): คะแนนตรงเวลา, one score per tag (หมวดหมู่), and คะแนนรวม = the mean of
 * คะแนนตรงเวลา and the tag scores the member has work in. Unapproved tasks are skipped.
 */
export function memberScores(tasks: ScoredTask[]) {
  const acc: Record<string, { n: number; onTime: number[]; tags: Record<string, number[]> }> = {};
  for (const t of tasks) {
    if (t.lateOnly !== undefined) {
      const m = (acc[t.owner] ??= { n: 0, onTime: [], tags: {} });
      m.n++;
      m.onTime.push(t.lateOnly / 10);
      continue;
    }
    const sc = taskScore(t.sends);
    if (!sc) continue;
    const m = (acc[t.owner] ??= { n: 0, onTime: [], tags: {} });
    m.n++;
    m.onTime.push(sc.onTime / 10);
    for (const tag of t.tags) (m.tags[tag] ??= []).push(sc.task / 10); // tag score = the task score (on time + every round)
  }
  const out: Record<string, { overall: number; onTime: number; byTag: Record<string, number>; tasks: number }> = {};
  for (const [owner, m] of Object.entries(acc)) {
    const onTime = mean(m.onTime); // คะแนนตรงเวลา: the approved send against the latest due date
    const byTag = Object.fromEntries(Object.entries(m.tags).map(([k, v]) => [k, mean(v)]));
    out[owner] = { overall: mean([onTime, ...Object.values(byTag)]), onTime, byTag, tasks: m.n };
  }
  return out;
}

export type PerformanceRow = {
  line_user_id: string; name: string; tasks: number; overall: number; overall5: number;
  onTime: number; onTime5: number;
  byTag: Record<string, { raw: number; scaled: number }>;
};

/** One row per member with approved tasks; overall and each tag scaled 1–5 across those members. */
export function performanceRows(tasks: ScoredTask[], names: Record<string, string>): PerformanceRow[] {
  const m = memberScores(tasks);
  const overall5 = scale(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.overall])));
  const onTime5 = scale(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.onTime])));
  const tags = new Set(Object.values(m).flatMap((v) => Object.keys(v.byTag)));
  const tag5: Record<string, Record<string, number>> = {};
  for (const tag of tags) {
    tag5[tag] = scale(Object.fromEntries(Object.entries(m).filter(([, v]) => tag in v.byTag).map(([k, v]) => [k, v.byTag[tag]])));
  }
  return Object.entries(m).map(([id, v]) => ({
    line_user_id: id,
    name: names[id] ?? id,
    tasks: v.tasks,
    overall: v.overall,
    overall5: overall5[id],
    onTime: v.onTime,
    onTime5: onTime5[id],
    byTag: Object.fromEntries(Object.entries(v.byTag).map(([tag, raw]) => [tag, { raw, scaled: tag5[tag][id] }])),
  }));
}

/** 1 + 4·(x − min)/(max − min) across everyone given; 5 for all when min = max (incl. one member). */
export function scale(values: Record<string, number>): Record<string, number> {
  const xs = Object.values(values);
  const min = Math.min(...xs), max = Math.max(...xs);
  return Object.fromEntries(
    Object.entries(values).map(([k, x]) => [k, max === min ? 5 : 1 + (4 * (x - min)) / (max - min)]),
  );
}

/** Who sees which performance rows: admins see everyone; anyone else only their own row (never other people's). */
export function visibleRows<T extends { line_user_id: string }>(rows: T[], me: { line_user_id: string; role: string }): T[] {
  return me.role === "admin" ? rows : rows.filter((r) => r.line_user_id === me.line_user_id);
}
