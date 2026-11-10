// Drive file/folder names for archived ส่งงาน files (archive.ts). Pure, unit-tested.
import type { Task } from "./sheetRows.ts";

export const clean = (s: string) => s.replace(/[\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/** Searchable in Drive by date, task number, building or title: "2026-11-10 งาน#12 อาคาร A - สรุปคดี - scan.pdf". */
export function driveName(day: string, task: Pick<Task, "id" | "building" | "title"> | undefined, file: string): string {
  const head = task ? `${day} งาน#${task.id} ${clean(task.building)} - ${clean(task.title).slice(0, 80)} - ` : `${day} (ไม่ได้แนบงาน) `;
  return head + clean(file);
}
