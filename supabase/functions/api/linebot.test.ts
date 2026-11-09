import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { HERO_URL, postbackReply, sendIdOf, taskBubble, taskMessages, validSignature } from "./linebot.ts";

const task = { id: 7, title: "ร่างหนังสือทวงถาม", building: "อาคาร A", details: "แนบสำเนา", due: "2026-11-20" };

test("bubble: same look as the old script (hero picture, title, กำหนดส่ง / ชื่อนิติ / รายละเอียด) + ส่งงาน postback", () => {
  const b = taskBubble(task);
  assert.equal(b.type, "bubble");
  assert.equal(b.hero.url, HERO_URL);
  const text = JSON.stringify(b.body);
  for (const s of ["งานใหม่: ร่างหนังสือทวงถาม", "กำหนดส่ง", "20/11/2569", "ชื่อนิติ", "อาคาร A", "รายละเอียด", "แนบสำเนา"]) assert.ok(text.includes(s), s);
  assert.deepEqual(b.footer.contents[0].action, { type: "postback", label: "ส่งงาน", data: "send=7", displayText: "ส่งงาน ร่างหนังสือทวงถาม" });
  assert.ok(JSON.stringify(taskBubble({ ...task, details: null }).body).includes('"-"'));
});

test("messages: one bubble alone; more go in carousels of 12, at most 5 messages (60 tasks)", () => {
  assert.equal(taskMessages([task])[0].contents.type, "bubble");
  const many = taskMessages(Array.from({ length: 70 }, (_, i) => ({ ...task, id: i })));
  assert.equal(many.length, 5);
  assert.equal(many[0].contents.type, "carousel");
  assert.equal((many[0].contents as { contents: unknown[] }).contents.length, 12);
  assert.match(many[0].altText, /งานใหม่/);
});

test("postback data: send=<id> only", () => {
  assert.equal(sendIdOf("send=12"), 12);
  assert.equal(sendIdOf("row=12"), null);
  assert.equal(sendIdOf("send=abc"), null);
  assert.equal(sendIdOf(undefined), null);
});

test("signature: HMAC-SHA256 of the raw body with the channel secret, base64", async () => {
  const body = '{"events":[]}';
  const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
  assert.equal(await validSignature("s3cret", body, sig), true);
  assert.equal(await validSignature("s3cret", body + " ", sig), false);
  assert.equal(await validSignature("other", body, sig), false);
  assert.equal(await validSignature("s3cret", body, null), false);
  assert.equal(await validSignature("s3cret", body, "not base64!!"), false);
});

test("reply wording follows the old script", () => {
  const t = (state: string, fix_round = 0) => ({ title: "งาน A", state, fix_round });
  assert.equal(postbackReply(t("on_process"), true), "ส่งงาน งาน A เรียบร้อย ✅");
  assert.equal(postbackReply(t("on_process", 2), true), "ส่งแก้ไขงาน งาน A ครั้งที่ 2 เรียบร้อย ✅");
  assert.equal(postbackReply(t("submitted"), false), "⏳ งาน งาน A อยู่ระหว่างการตรวจสอบ");
  assert.equal(postbackReply(t("submitted", 1), false), "⏳ แก้ไขงาน งาน A ครั้งที่ 1 อยู่ระหว่างการตรวจสอบ");
  assert.equal(postbackReply(t("approved"), false), "✅ งาน งาน A อนุมัติแล้ว");
  assert.equal(postbackReply(t("cancelled"), false), "งาน งาน A ถูกยกเลิกแล้ว");
  assert.equal(postbackReply(null, false), "❌ ไม่พบข้อมูลงานในระบบ");
});
