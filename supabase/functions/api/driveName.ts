// Drive file/folder names for archived ส่งงาน files (archive.ts). Pure, unit-tested.
import { bangkokDate } from "./dates.ts";
import type { Task } from "./sheetRows.ts";

export const clean = (s: string) => s.replace(/[\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/** Searchable in Drive by date, task number, building or title: "2026-11-10 งาน#12 อาคาร A - สรุปคดี - scan.pdf". */
export function driveName(day: string, task: Pick<Task, "id" | "building" | "title"> | undefined, file: string): string {
  const head = task ? `${day} งาน#${task.id} ${clean(task.building)} - ${clean(task.title).slice(0, 80)} - ` : `${day} (ไม่ได้แนบงาน) `;
  return head + clean(file);
}

/** Drive folder for a task's files (members upload in the app): "12-2026-11-17-สรุปคดี-สมชาย-อาคาร A" (date = assigned, Bangkok). */
export function taskFolderName(t: Pick<Task, "id" | "created_at" | "title" | "owner_name" | "building">): string {
  const made = new Date(t.created_at);
  const day = isNaN(made.getTime()) ? String(t.created_at ?? "").slice(0, 10) : bangkokDate(made);
  return [String(t.id), day, clean(t.title).slice(0, 80), t.owner_name, t.building].map(clean).filter(Boolean).join("-");
}
