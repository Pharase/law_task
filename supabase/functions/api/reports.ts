// Monthly reports come in two kinds, told apart by the file name.
export const REPORT_KINDS = ["ชั้นฟ้อง", "ชั้นบังคับคดี"];

/** Newest file whose name has each kind (files come newest first); just the newest file when no name matches. */
export function latestPerKind<T extends { name: string }>(files: T[]): T[] {
  const picked = REPORT_KINDS.map((k) => files.find((f) => f.name.normalize("NFC").includes(k))).filter((f): f is T => !!f);
  return picked.length ? picked : files.slice(0, 1);
}
