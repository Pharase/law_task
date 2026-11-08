import { test } from "node:test";
import assert from "node:assert/strict";
import { adminDigest, memberDigest, shouldRunDigest } from "./digest.ts";

const t = (title: string) => ({ title, building: "อาคาร X", due: "2026-03-15" });
const empty = { newTasks: [], dueToday: [], overdue: [], sentBack: [], approved: [] };

test("empty member digest -> null", () => assert.equal(memberDigest(empty), null));

test("sent back shows reason and note", () => {
  const text = memberDigest({ ...empty, sentBack: [{ ...t("ร่างหนังสือ"), reason: "มีปรับแก้", note: "แก้ข้อ 2" }] })!;
  assert.match(text, /มีปรับแก้/);
  assert.match(text, /แก้ข้อ 2/);
  assert.match(text, /ร่างหนังสือ/);
});

test("long lists are capped at 10 with +N more", () => {
  const text = memberDigest({ ...empty, newTasks: Array.from({ length: 13 }, (_, i) => t("งาน " + i)) })!;
  assert.match(text, /งาน 9/);
  assert.doesNotMatch(text, /งาน 10\b/);
  assert.match(text, /\+3/);
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
