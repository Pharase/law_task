// LINE Messaging API pieces that need no network: the task bubble (same look as the old script's
// sendLineFlex), the "ส่งงาน" postback data, the webhook signature check, and the reply wording.
// Pure: no Deno or npm imports, so node tests run it.

/** Picture at the top of every task bubble (the old script's hero image). */
export const HERO_URL = "https://img5.pic.in.th/file/secure-sv1/Namelist---43ef5eb376324ab3d.png";
const PER_CAROUSEL = 12, MAX_MESSAGES = 5; // LINE limits: 12 bubbles per carousel, 5 messages per push

export type BubbleTask = { id: number; title: string; building: string; details: string | null; due: string };

/** yyyy-mm-dd -> dd/mm/yyyy (Buddhist year), like the web app. */
const thDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${Number(y) + 543}`; };

const row = (label: string, value: string, color: string) => ({
  type: "box", layout: "baseline", spacing: "sm", contents: [
    { type: "text", text: label, color: "#aaaaaa", size: "sm", flex: 2 },
    { type: "text", text: value || "-", wrap: true, color, size: "sm", flex: 5 },
  ],
});

export function taskBubble(t: BubbleTask) {
  return {
    type: "bubble",
    hero: { type: "image", url: HERO_URL, size: "full", aspectMode: "cover", aspectRatio: "20:13" },
    body: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: "งานใหม่: " + t.title, weight: "bold", size: "xl", wrap: true },
        { type: "box", layout: "vertical", margin: "lg", spacing: "sm", contents: [
          row("กำหนดส่ง", thDate(t.due), "#ff0000"),
          row("ชื่อนิติ", t.building, "#666666"),
          row("รายละเอียด", (t.details ?? "").trim().slice(0, 500), "#666666"),
        ] },
      ],
    },
    footer: {
      type: "box", layout: "vertical", spacing: "sm", flex: 0, contents: [{
        type: "button", style: "primary", height: "sm",
        // same as pressing ส่งงาน in the web app; displayText shows in the chat so the person sees what they pressed
        action: { type: "postback", label: "ส่งงาน", data: `send=${t.id}`, displayText: `ส่งงาน ${t.title}`.slice(0, 300) },
      }],
    },
    styles: { body: { separator: true } },
  };
}

/** Flex messages for one push: a single bubble, or carousels of 12. Tasks past 60 are left out (caller keeps them unmarked). */
export function taskMessages(tasks: BubbleTask[]) {
  const altText = `มีงานใหม่รอดำเนินการ ${tasks.length} งาน`;
  if (tasks.length === 1) return [{ type: "flex", altText, contents: taskBubble(tasks[0]) }];
  const out = [];
  for (let i = 0; i < tasks.length && out.length < MAX_MESSAGES; i += PER_CAROUSEL) {
    out.push({ type: "flex", altText, contents: { type: "carousel", contents: tasks.slice(i, i + PER_CAROUSEL).map(taskBubble) } });
  }
  return out;
}
export const MAX_TASKS_PER_PUSH = PER_CAROUSEL * MAX_MESSAGES;

/** Task id from the button's postback data ("send=12"); null for anything else. */
export function sendIdOf(data: unknown): number | null {
  const m = /^send=(\d+)$/.exec(String(data ?? ""));
  return m ? Number(m[1]) : null;
}

/** LINE signs each webhook call: base64(HMAC-SHA256(channel secret, raw body)) in X-Line-Signature. */
export async function validSignature(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let sig: Uint8Array;
  try { sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)); } catch { return false; }
  return await crypto.subtle.verify("HMAC", key, sig, enc.encode(body)); // constant-time compare
}

/** Reply after ส่งงาน (old script wording). sentNow = this press sent it; otherwise it tells the current state. */
export function postbackReply(t: { title: string; state: string; fix_round: number } | null, sentNow: boolean): string {
  if (!t) return "❌ ไม่พบข้อมูลงานในระบบ";
  const round = t.fix_round > 0;
  if (sentNow) return round ? `ส่งแก้ไขงาน ${t.title} ครั้งที่ ${t.fix_round} เรียบร้อย ✅` : `ส่งงาน ${t.title} เรียบร้อย ✅`;
  if (t.state === "submitted") return round ? `⏳ แก้ไขงาน ${t.title} ครั้งที่ ${t.fix_round} อยู่ระหว่างการตรวจสอบ` : `⏳ งาน ${t.title} อยู่ระหว่างการตรวจสอบ`;
  if (t.state === "approved") return `✅ งาน ${t.title} อนุมัติแล้ว`;
  if (t.state === "cancelled") return `งาน ${t.title} ถูกยกเลิกแล้ว`;
  return "❌ ไม่พบข้อมูลงานในระบบ";
}
