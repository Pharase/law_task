// Review rules (spec "States"): approve, กดผิด (void send, no scoring effect), มีปรับแก้ (scored fix round).
export const TAGS = ["ความถูกต้อง", "เสนออนุมัติ/ลงนามกรรมการ", "การประสานงาน", "ติดตามความคืบหน้าคดี"] as const;

export type Decision = "approved" | "กดผิด" | "มีปรับแก้";
const DECISIONS: Decision[] = ["approved", "กดผิด", "มีปรับแก้"];

export function validateReview(
  input: { decision: string; note?: string; nextDueOn?: string },
  today: string,
): { decision: Decision; note: string | null; nextDueOn: string | null } {
  const decision = input.decision as Decision;
  if (!DECISIONS.includes(decision)) throw new Error("decision must be approved, กดผิด or มีปรับแก้");
  if (decision !== "มีปรับแก้") return { decision, note: null, nextDueOn: null };
  const note = (input.note ?? "").trim();
  if (!note) throw new Error("fix note is required for มีปรับแก้");
  if (note.length > 2000) throw new Error("fix note is over 2000 characters");
  const nextDueOn = input.nextDueOn ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueOn)) throw new Error("new due date is required for มีปรับแก้");
  if (nextDueOn < today) throw new Error("new due date can't be in the past");
  return { decision, note, nextDueOn };
}

export function reviewEffect(decision: Decision, nextDueOn: string | null): {
  taskState: "approved" | "on_process";
  sendOutcome: "approved" | "void" | "fix";
  newDueOn: string | null;
  fixRoundDelta: 0 | 1;
} {
  if (decision === "approved") return { taskState: "approved", sendOutcome: "approved", newDueOn: null, fixRoundDelta: 0 };
  if (decision === "กดผิด") return { taskState: "on_process", sendOutcome: "void", newDueOn: null, fixRoundDelta: 0 };
  return { taskState: "on_process", sendOutcome: "fix", newDueOn: nextDueOn, fixRoundDelta: 1 };
}

export const canSend = (task: { owner: string; state: string }, me: string): boolean =>
  task.owner === me && task.state === "on_process";
