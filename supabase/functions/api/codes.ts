// Invite codes: 8 chars, no look-alikes (0/O, 1/I/L).
export const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars

export function newCode(): string {
  let out = "";
  while (out.length < 8) {
    const [b] = crypto.getRandomValues(new Uint8Array(1));
    if (b < 248) out += CODE_CHARS[b % 31]; // 248 = 31*8, rejects bytes that would bias the pick
  }
  return out;
}

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[\s-]/g, "");
