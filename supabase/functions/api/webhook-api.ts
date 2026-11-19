// LINE webhook (Messaging API → Webhook URL = this function). Handles the "ส่งงาน" postback button of OLD task bubbles
// (new ones open the app directly). Sending now needs a choice (เอกสารตัวจริง / ไฟล์ออนไลน์) the postback can't carry, so
// it doesn't send: the free reply is a bubble whose button opens that task in the app (?task=N), where the member picks and sends.
import { linkMessage, postbackReply, sendIdOf, validSignature } from "./linebot.ts";
import { replyMessages } from "./notify-api.ts";
import { loadSheet } from "./sheet.ts";
import { loadLine } from "./settings-api.ts";
import { db } from "./shared.ts";

/** The reply when `userId` presses an old bubble's ส่งงาน on task `id`. */
async function pressSend(id: number, userId: string, app: string): Promise<unknown> {
  const p = (await db.from("profiles").select("role").eq("line_user_id", userId).maybeSingle()).data;
  const t = p && (p.role === "member" || p.role === "admin") ? (await loadSheet()).tasks.find((x) => x.id === id) : undefined;
  if (t && t.owner === userId && t.state === "on_process") {
    return linkMessage(`งาน ${t.title}\nกดปุ่มด้านล่างเพื่อเปิดงานนี้ในแอป เลือกวิธีส่งเอกสาร (ตัวจริง / ไฟล์ออนไลน์) แล้วกดส่งงาน`,
      `${app}?task=${id}`, null, "เปิดงานนี้ในแอป");
  }
  // sent already / approved / cancelled, or not theirs (anyone else hears "not found"; revoked / unknown too)
  return { type: "text", text: postbackReply(t && t.owner === userId ? t : null, false) };
}

/** Returns the HTTP status for LINE. Signature first: without the channel secret nothing is trusted. */
export async function lineWebhook(raw: string, signature: string | null): Promise<number> {
  const { secret, token, liffUrl: app } = await loadLine();
  if (!secret || !token) { console.error("webhook: channel secret or access token not set (ตั้งค่า → Linkage)"); return 500; }
  if (!(await validSignature(secret, raw, signature))) return 401;
  const events = (JSON.parse(raw).events ?? []) as { type: string; replyToken?: string; source?: { userId?: string }; postback?: { data?: string } }[];
  for (const ev of events) {
    const id = sendIdOf(ev.postback?.data);
    if (ev.type !== "postback" || id === null || !ev.source?.userId || !ev.replyToken) continue; // chats, follows, LINE's "Verify": nothing to do
    let reply: unknown;
    try { reply = await pressSend(id, ev.source.userId, app); } catch (e) {
      console.error("webhook send", e);
      reply = linkMessage("❌ เปิดงานไม่สำเร็จ ลองกดอีกครั้ง หรือเปิดในแอป", app, null, "เปิดแอป");
    }
    await replyMessages(ev.replyToken, [reply], token);
  }
  return 200;
}
