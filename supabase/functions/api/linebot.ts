// LINE Messaging API pieces that need no network: the task bubble (same look as the old script's
// sendLineFlex), the "ส่งงาน" postback data, the webhook signature check, and the reply wording.
// Pure: no Deno or npm imports, so node tests run it.

import { DEFAULT_LIFF_ID, liffUrl } from "./lineconfig.ts";

/** The built-in LIFF app (home page = Work dashboard); the live one comes from loadLine().liffUrl. */
export const LIFF_URL = liffUrl(DEFAULT_LIFF_ID);
// No picture on bubbles unless an admin adds one in ตั้งค่า (settings.taskHero / adminHero).
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

export function taskBubble(t: BubbleTask, hero?: string | null, app = LIFF_URL) {
  return {
    type: "bubble",
    ...(hero && { hero: { type: "image", url: hero, size: "full", aspectMode: "fit", aspectRatio: "1:1", backgroundColor: "#FFFFFF" } }), // the picture's own shape, nothing cropped
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
        // opens the LIFF app on this task (attach files + send there); bubbles sent earlier still use the send= postback below
        action: { type: "uri", label: "ส่งงาน", uri: `${app}?task=${t.id}` },
      }],
    },
    styles: { body: { separator: true } },
  };
}

/** Flex messages for one push: a single bubble, or carousels of 12. Tasks past 60 are left out (caller keeps them unmarked). */
export function taskMessages(tasks: BubbleTask[], hero?: string | null, app = LIFF_URL) {
  const altText = `มีงานใหม่รอดำเนินการ ${tasks.length} งาน`;
  if (tasks.length === 1) return [{ type: "flex", altText, contents: taskBubble(tasks[0], hero, app) }];
  const out = [];
  for (let i = 0; i < tasks.length && out.length < MAX_MESSAGES; i += PER_CAROUSEL) {
    out.push({ type: "flex", altText, contents: { type: "carousel", contents: tasks.slice(i, i + PER_CAROUSEL).map((t) => taskBubble(t, hero, app)) } });
  }
  return out;
}
export const MAX_TASKS_PER_PUSH = PER_CAROUSEL * MAX_MESSAGES;

/**
 * Text push (daily สรุปงานวันนี้, test message) as a bubble: the text, then a button to the app instead of a bare link.
 * highlight: line start -> background colour; those lines become bold pills (the summary's status headers).
 */
export function linkMessage(text: string, link: string, hero?: string | null, label = "ดูรายการงานทั้งหมดที่นี่", highlight: Record<string, string> = {}) {
  const lines = text.slice(0, 2000).split("\n");
  // LINE refuses empty text, so blank lines become a gap before the next line
  const body = lines.map((l, i) => {
    if (!l) return null;
    const margin = i > 0 && !lines[i - 1] ? { margin: "lg" } : {};
    const bg = Object.entries(highlight).find(([k]) => l.startsWith(k))?.[1];
    return bg
      ? { type: "box", layout: "vertical", backgroundColor: bg, cornerRadius: "md", paddingAll: "sm", ...margin,
        contents: [{ type: "text", text: l, wrap: true, size: "sm", weight: "bold", color: "#000000" }] }
      : { type: "text", text: l, wrap: true, size: "sm", ...margin };
  }).filter(Boolean);
  return {
    type: "flex", altText: text.slice(0, 400),
    contents: {
      type: "bubble",
      ...(hero && { hero: { type: "image", url: hero, size: "full", aspectMode: "fit", aspectRatio: "1:1", backgroundColor: "#FFFFFF" } }),
      body: { type: "box", layout: "vertical", spacing: "xs", contents: body },
      footer: { type: "box", layout: "vertical", contents: [
        { type: "button", style: "primary", height: "sm", action: { type: "uri", label, uri: link } },
      ] },
    },
  };
}

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
