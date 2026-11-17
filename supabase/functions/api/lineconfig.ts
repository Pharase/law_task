// LINE OA linkage (members page → ตั้งค่า → Linkage): bot token, channel secret and LIFF ID.
// Saved values win; anything not saved falls back to the Supabase secrets / the built-in LIFF ID.
// Pure: no Deno or npm imports, so node tests run it. Stored as app_settings.key = 'line'.

/** The LIFF app the code shipped with. Always accepted at login, so a bad saved ID can't lock admins out. */
export const DEFAULT_LIFF_ID = "2012450429-k3WOCwtO";
export const liffUrl = (liffId: string) => `https://liff.line.me/${liffId}`;
/** "2012450429-k3WOCwtO" -> "2012450429": the LINE Login channel the ID tokens are issued for. */
export const channelOf = (liffId: string) => liffId.split("-")[0];

export type LineStored = { token?: string; secret?: string; liffId?: string };
export type LineEnv = { token?: string; secret?: string; channelId?: string };
export type LineConfig = { token: string | null; secret: string | null; liffId: string; liffUrl: string; channelIds: string[] };

const LIFF_ID = /^\d{6,}-[A-Za-z0-9]{4,}$/;

export function resolveLine(stored: LineStored | null | undefined, env: LineEnv): LineConfig {
  const s = stored ?? {};
  const liffId = s.liffId && LIFF_ID.test(s.liffId) ? s.liffId : DEFAULT_LIFF_ID;
  const channelIds = [...new Set([channelOf(liffId), channelOf(DEFAULT_LIFF_ID), env.channelId].filter((x): x is string => !!x))];
  return { token: s.token || env.token || null, secret: s.secret || env.secret || null, liffId, liffUrl: liffUrl(liffId), channelIds };
}

/** An admin's edit: blank or missing = keep the saved value. Throws a Thai message on bad input. */
// deno-lint-ignore no-explicit-any
export function normalizeLine(input: any, base: LineStored = {}): LineStored {
  const pick = (k: keyof LineStored) => (typeof input?.[k] === "string" && input[k].trim() ? input[k].trim() : base[k]);
  const out: LineStored = { token: pick("token"), secret: pick("secret"), liffId: pick("liffId") };
  if (out.liffId && !LIFF_ID.test(out.liffId)) throw new Error("LIFF ID ต้องเป็นรูปแบบ 1234567890-AbCdEfGh");
  if (out.secret && !/^[0-9a-f]{32}$/i.test(out.secret)) throw new Error("Channel secret ต้องเป็นตัวอักษร 0-9 a-f 32 ตัว");
  if (out.token && (out.token.length < 100 || /\s/.test(out.token))) throw new Error("Channel access token ไม่ถูกต้อง (คัดลอกมาไม่ครบ?)");
  return out;
}

/** Shown back to the admin: never the whole secret. */
export const masked = (s: string | null | undefined) => (s ? "••••" + s.slice(-4) : null);
