// Calendar dates as "YYYY-MM-DD" strings in Asia/Bangkok. Never derive a date from UTC.
const bkk = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });

export const bangkokDate = (d: Date): string => bkk.format(d);

const utcDay = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
export const daysBetween = (from: string, to: string): number => utcDay(to) - utcDay(from);

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export function periodRange(kind: "month" | "quarter", year: number, n: number): { from: string; to: string } {
  const first = kind === "month" ? n : (n - 1) * 3 + 1;
  const months = kind === "month" ? 1 : 3;
  return { from: iso(year, first, 1), to: iso(year, first + months, 0) }; // day 0 = last day of previous month
}
