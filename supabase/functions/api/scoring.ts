// PROVISIONAL scoring (spec "Performance"): change rules only here.
// Mirrors the old sheet: filter_task J (on time), K (accuracy), L (task); Team_summary O/P (average, 1–5 scale).
import { daysBetween } from "./dates.ts";

export type Send = { sentOn: string; dueOn: string; outcome: "pending" | "approved" | "fix" | "void" };
export type ScoredTask = { owner: string; tags: string[]; sends: Send[] };

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

/** Per owner: average task score / 10 (0–1), overall and per tag. Unapproved tasks are skipped. */
export function memberScores(tasks: ScoredTask[]) {
  const acc: Record<string, { all: number[]; tags: Record<string, number[]> }> = {};
  for (const t of tasks) {
    const sc = taskScore(t.sends);
    if (!sc) continue;
    const m = (acc[t.owner] ??= { all: [], tags: {} });
    m.all.push(sc.task / 10);
    for (const tag of t.tags) (m.tags[tag] ??= []).push(sc.task / 10);
  }
  const out: Record<string, { overall: number; byTag: Record<string, number>; tasks: number }> = {};
  for (const [owner, m] of Object.entries(acc)) {
    out[owner] = {
      overall: mean(m.all),
      byTag: Object.fromEntries(Object.entries(m.tags).map(([k, v]) => [k, mean(v)])),
      tasks: m.all.length,
    };
  }
  return out;
}

export type PerformanceRow = {
  line_user_id: string; name: string; tasks: number; overall: number; overall5: number;
  byTag: Record<string, { raw: number; scaled: number }>;
};

/** One row per member with approved tasks; overall and each tag scaled 1–5 across those members. */
export function performanceRows(tasks: ScoredTask[], names: Record<string, string>): PerformanceRow[] {
  const m = memberScores(tasks);
  const overall5 = scale(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.overall])));
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
