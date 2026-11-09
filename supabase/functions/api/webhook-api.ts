// LINE webhook (Messaging API → Webhook URL = this function). Handles the bubble's "ส่งงาน" button:
// the same send as the web app (submitTask), then a free reply with the old script's wording.
import { postbackReply, sendIdOf, validSignature } from "./linebot.ts";
import { replyText } from "./notify-api.ts";
import { loadSheet } from "./sheet.ts";
import { db, HttpError } from "./shared.ts";
import { submitTask } from "./tasks-api.ts";

/** What to reply when `userId` presses ส่งงาน on task `id`. */
async function pressSend(id: number, userId: string): Promise<string> {
  const p = (await db.from("profiles").select("role").eq("line_user_id", userId).maybeSingle()).data;
  if (!p || (p.role !== "member" && p.role !== "admin")) return postbackReply(null, false); // revoked / unknown: like a missing task
  try {
    return postbackReply(await submitTask(id, userId), true);
  } catch (e) {
    if (!(e instanceof HttpError) || ![403, 404, 409].includes(e.status)) throw e;
    // not sent now: say where the task is (only to its owner; anyone else hears "not found")
    const t = (await loadSheet()).tasks.find((x) => x.id === id);
    return postbackReply(t && t.owner === userId ? t : null, false);
  }
}

/** Returns the HTTP status for LINE. Signature first: without the channel secret nothing is trusted. */
export async function lineWebhook(raw: string, signature: string | null): Promise<number> {
  const secret = Deno.env.get("LINE_CHANNEL_SECRET"), token = Deno.env.get("LINE_MESSAGING_TOKEN");
  if (!secret || !token) { console.error("webhook: LINE_CHANNEL_SECRET or LINE_MESSAGING_TOKEN not set"); return 500; }
  if (!(await validSignature(secret, raw, signature))) return 401;
  const events = (JSON.parse(raw).events ?? []) as { type: string; replyToken?: string; source?: { userId?: string }; postback?: { data?: string } }[];
  for (const ev of events) {
    const id = sendIdOf(ev.postback?.data);
    if (ev.type !== "postback" || id === null || !ev.source?.userId || !ev.replyToken) continue; // chats, follows, LINE's "Verify": nothing to do
    let text: string;
    try { text = await pressSend(id, ev.source.userId); } catch (e) {
      console.error("webhook send", e);
      text = "❌ ส่งงานไม่สำเร็จ ลองกดอีกครั้ง หรือส่งในแอป";
    }
    await replyText(ev.replyToken, text, token);
  }
  return 200;
}
