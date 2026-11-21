import { test } from "node:test";
import assert from "node:assert/strict";
import { adminDigest, approvedRecently, memberDigest, shouldRunDigest } from "./digest.ts";

const t = (title: string) => ({ title, building: "อาคาร X", due: "2026-03-15" });
const empty = { newTasks: [], dueSoon: [], overdue: [], sentBack: [], approved: [] };

test("empty member digest -> null", () => assert.equal(memberDigest(empty), null));

test("sent back shows reason and note", () => {
  const text = memberDigest({ ...empty, sentBack: [{ ...t("ร่างหนังสือ"), reason: "มีปรับแก้", note: "แก้ข้อ 2" }] })!;
  assert.match(text, /มีปรับแก้/);
  assert.match(text, /แก้ข้อ 2/);
  assert.match(text, /ร่างหนังสือ/);
});

test("lists show the 3 nearest due, then *กับอีก N งาน", () => {
  const days = [20, 12, 25, 11, 13]; // nearest three: 11, 12, 13
  const text = memberDigest({ ...empty, overdue: days.map((d) => ({ ...t("งาน " + d), due: `2026-03-${d}` })) })!;
  assert.match(text, /งาน 11[\s\S]*งาน 12[\s\S]*งาน 13/);
  assert.doesNotMatch(text, /งาน 20|งาน 25/);
  assert.match(text, /\*กับอีก 2 งาน$/);
  const three = memberDigest({ ...empty, overdue: [t("a"), t("b"), t("c")] })!;
  assert.doesNotMatch(three, /กับอีก/);
});

test("linkMessage: header lines get a neon pill, blank lines are dropped", async () => {
  const { linkMessage } = await import("./linebot.ts");
  const { NEON } = await import("./digest.ts");
  const text = memberDigest({ ...empty, overdue: [t("x")] })!;
  // deno-lint-ignore no-explicit-any
  const body: any[] = linkMessage(text, "https://x", null, undefined, NEON).contents.body.contents;
  assert.equal(body.length, 3); // สรุปงานวันนี้, header pill, the task
  assert.equal(body[1].backgroundColor, NEON["‼️ เลยกำหนด"]);
  assert.equal(body[1].margin, "lg");
  assert.ok(body.every((c) => c.type === "box" || c.text));
});

test("only weekdays after 09:00 Bangkok, once per day", () => {
  assert.equal(shouldRunDigest(new Date("2026-03-02T01:59:00Z"), null), false); // Mon 08:59
  assert.equal(shouldRunDigest(new Date("2026-03-02T02:05:00Z"), null), true);  // Mon 09:05
  assert.equal(shouldRunDigest(new Date("2026-03-02T05:00:00Z"), "2026-03-02"), false);
  assert.equal(shouldRunDigest(new Date("2026-03-07T03:00:00Z"), null), false); // Sat
  assert.equal(shouldRunDigest(new Date("2026-03-01T17:30:00Z"), null), false); // Mon 00:30 Bangkok
});

test("admin digest null when nothing waiting and no backup", () =>
  assert.equal(adminDigest({ waiting: [], backupDue: 0, quotaLow: false }), null));

test("admin digest lists waiting and backup count", () => {
  const text = adminDigest({ waiting: [{ ...t("งานรอตรวจ"), owner: "สมชาย" }], backupDue: 4, quotaLow: false })!;
  assert.match(text, /งานรอตรวจ/);
  assert.match(text, /สมชาย/);
  assert.match(text, /4/);
});

test("instant notice only in working hours 08:30-17:30 Bangkok (UTC+7)", async () => {
  const { isWorkingHours } = await import("./digest.ts");
  assert.equal(isWorkingHours(new Date("2026-11-09T01:29:00Z")), false); // 08:29
  assert.equal(isWorkingHours(new Date("2026-11-09T01:30:00Z")), true);  // 08:30
  assert.equal(isWorkingHours(new Date("2026-11-09T10:29:00Z")), true);  // 17:29
  assert.equal(isWorkingHours(new Date("2026-11-09T10:30:00Z")), false); // 17:30
  assert.equal(isWorkingHours(new Date("2026-11-09T15:00:00Z")), false); // 22:00
});

test("due within 3 days: not sent yet, oldest assigned first, then nearest due; days left shown", async () => {
  const { dueSoon } = await import("./digest.ts");
  const mk = (title: string, assigned: string, due: string) => ({ title, building: "B", due, assigned });
  const list = dueSoon([
    mk("late", "2026-03-01T01:00:00Z", "2026-03-09"),   // overdue: not here
    mk("far", "2026-03-01T01:00:00Z", "2026-03-14"),    // 4 days: not here
    mk("new-near", "2026-03-08T01:00:00Z", "2026-03-10"),
    mk("old-far", "2026-03-02T01:00:00Z", "2026-03-13"),
    mk("old-near", "2026-03-02T01:00:00Z", "2026-03-11"),
    mk("today", "2026-03-05T01:00:00Z", "2026-03-10"),
  ], "2026-03-10");
  assert.deepEqual(list.map((t) => t.title), ["old-near", "old-far", "today", "new-near"]);
  assert.deepEqual(list.map((t) => t.daysLeft), [1, 3, 0, 0]);
  const text = memberDigest({ ...empty, dueSoon: list })!;
  assert.match(text, /ใกล้ครบกำหนด/);
  assert.match(text, /old-near \(B\) กำหนด .* · อีก 1 วัน/);
  assert.match(text, /today \(B\) กำหนด .* · วันนี้/);
});

test("splitActive: every task in exactly one section (sent back > overdue > due soon > new)", async () => {
  const { splitActive } = await import("./digest.ts");
  const mk = (id: number, due: string) => ({ id, title: "t" + id, building: "B", due, assigned: "2026-03-01" });
  const s = splitActive(
    [mk(1, "2026-03-09"), mk(2, "2026-03-11"), mk(3, "2026-03-30"), mk(4, "2026-03-09"), mk(5, "2026-03-30")],
    new Set([1, 2, 3, 4]), new Set([4]), "2026-03-10", // all new except 5; 4 was sent back
  );
  assert.deepEqual(s.overdue.map((t) => t.id), [1]);
  assert.deepEqual(s.dueSoon.map((t) => t.id), [2]);
  assert.deepEqual(s.newTasks.map((t) => t.id), [3]);
});

test("approvedRecently: approvals reviewed yesterday or today (Bangkok) only", () => {
  const s = (reviewed_at: string | null, outcome = "approved") => ({ outcome, reviewed_at });
  const got = approvedRecently([
    s("2026-11-18T02:00:00Z"), // yesterday 09:00 Bangkok
    s("2026-11-17T17:30:00Z"), // 18 Nov 00:30 Bangkok = yesterday
    s("2026-11-17T16:30:00Z"), // 17 Nov 23:30 Bangkok = two days ago
    s("2026-11-19T00:30:00Z"), // this morning
    s(null), s("2026-11-18T02:00:00Z", "fix"),
  ], "2026-11-19");
  assert.deepEqual(got.map((x) => x.reviewed_at), ["2026-11-18T02:00:00Z", "2026-11-17T17:30:00Z", "2026-11-19T00:30:00Z"]);
});
