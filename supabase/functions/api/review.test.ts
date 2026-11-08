import { test } from "node:test";
import assert from "node:assert/strict";
import { canSend, reviewEffect, TAGS, validateReview } from "./review.ts";

const today = "2026-03-10";

test("approve", () =>
  assert.deepEqual(reviewEffect("approved", null),
    { taskState: "approved", sendOutcome: "approved", newDueOn: null, fixRoundDelta: 0 }));

test("กดผิด keeps due date", () =>
  assert.deepEqual(reviewEffect("กดผิด", null),
    { taskState: "on_process", sendOutcome: "void", newDueOn: null, fixRoundDelta: 0 }));

test("มีปรับแก้ sets new due + round", () =>
  assert.deepEqual(reviewEffect("มีปรับแก้", "2026-03-15"),
    { taskState: "on_process", sendOutcome: "fix", newDueOn: "2026-03-15", fixRoundDelta: 1 }));

test("มีปรับแก้ needs note", () =>
  assert.throws(() => validateReview({ decision: "มีปรับแก้", note: "  ", nextDueOn: "2026-03-15" }, today), /note/i));

test("มีปรับแก้ needs date", () =>
  assert.throws(() => validateReview({ decision: "มีปรับแก้", note: "fix p.2" }, today), /due/i));

test("มีปรับแก้ date not in past", () =>
  assert.throws(() => validateReview({ decision: "มีปรับแก้", note: "x", nextDueOn: "2026-03-09" }, today), /past/i));

test("มีปรับแก้ valid input is trimmed", () =>
  assert.deepEqual(validateReview({ decision: "มีปรับแก้", note: " fix p.2 ", nextDueOn: "2026-03-10" }, today),
    { decision: "มีปรับแก้", note: "fix p.2", nextDueOn: "2026-03-10" }));

test("approve ignores note and date", () =>
  assert.deepEqual(validateReview({ decision: "approved", note: "x", nextDueOn: "2026-03-15" }, today),
    { decision: "approved", note: null, nextDueOn: null }));

test("unknown decision", () => assert.throws(() => validateReview({ decision: "maybe" }, today)));

test("note over 2000 chars rejected", () =>
  assert.throws(() => validateReview({ decision: "มีปรับแก้", note: "x".repeat(2001), nextDueOn: "2026-03-15" }, today), /2000/));

test("canSend only own on_process task", () => {
  assert.equal(canSend({ owner: "U1", state: "on_process" }, "U1"), true);
  assert.equal(canSend({ owner: "U2", state: "on_process" }, "U1"), false);
  assert.equal(canSend({ owner: "U1", state: "submitted" }, "U1"), false);
});

test("TAGS are the four fixed tags", () =>
  assert.deepEqual([...TAGS], ["ความถูกต้อง", "เสนออนุมัติ/ลงนามกรรมการ", "การประสานงาน", "ติดตามความคืบหน้าคดี"]));
