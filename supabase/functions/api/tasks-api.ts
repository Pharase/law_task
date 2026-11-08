// Task actions (spec "Button A"). Rules live in review.ts / scoring.ts; this file only talks to the database.
import { bangkokDate, periodRange } from "./dates.ts";
import { canSend, reviewEffect, TAGS, validateReview } from "./review.ts";
import { performanceRows, type ScoredTask } from "./scoring.ts";
import { bucket, db, found, HttpError, type Me, must } from "./shared.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => bangkokDate(new Date());

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Tasks matching `filter`, with building, owner name, sends and (signed) files — 3 queries, not one per task. */
async function loadTasks(filter: (q: Row) => Row): Promise<Row[]> {
  const base = db.from("tasks")
    .select("*, buildings(name), owner_profile:profiles!tasks_owner_fkey(staff_name, display_name)")
    .order("current_due_on", { ascending: true });
  const tasks: Row[] = must(await filter(base) as { data: Row[] | null; error: unknown });
  if (!tasks.length) return [];
  const ids = tasks.map((t) => t.id);
  const sends: Row[] = must(await db.from("task_sends").select().in("task_id", ids).order("sent_at"));
  const files: Row[] = must(await db.from("files").select("id, task_id, send_id, name, mime, size, path, deleted_at").in("task_id", ids));
  const live = files.filter((f) => !f.deleted_at);
  const urls = live.length ? must(await bucket.createSignedUrls(live.map((f) => f.path), 3600)) : [];
  const urlOf = new Map(live.map((f, i) => [f.id, urls[i]?.signedUrl]));
  return tasks.map(({ buildings, owner_profile, ...t }) => ({
    ...t,
    building: buildings?.name ?? "",
    owner_name: owner_profile?.staff_name || owner_profile?.display_name || t.owner,
    sends: sends.filter((s) => s.task_id === t.id),
    files: files.filter((f) => f.task_id === t.id)
      .map(({ path: _p, ...f }) => (f.deleted_at ? f : { ...f, url: urlOf.get(f.id) })),
  }));
}

const one = async (id: number) => found((await loadTasks((q) => q.eq("id", id)))[0] ?? null, "task");

const taskId = (body: Row) => {
  const id = Number(body.task_id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "task_id is required");
  return id;
};

function checkTags(tags: unknown): string[] {
  if (!Array.isArray(tags) || !tags.length || !tags.every((t) => (TAGS as readonly string[]).includes(t))) {
    throw new HttpError(400, "pick at least one tag from the list");
  }
  return [...new Set(tags as string[])];
}

function checkTitle(title: unknown): string {
  const t = String(title ?? "").trim();
  if (!t || t.length > 200) throw new HttpError(400, "title is required (max 200 characters)");
  return t;
}

/** Actions for approved members (and admins). Returns undefined for actions it doesn't own. */
export async function memberTaskActions(action: string, body: Row, me: Me): Promise<unknown> {
  switch (action) {
    case "listBuildings":
      return must(await db.from("buildings").select("id, name").order("name"));

    case "performance": {
      const kind = body.kind === "quarter" ? "quarter" : body.kind === "month" ? "month" : null;
      const year = Number(body.year), n = Number(body.n);
      if (!kind || !Number.isInteger(year) || !Number.isInteger(n) || n < 1 || n > (kind === "month" ? 12 : 4)) {
        throw new HttpError(400, "kind must be month (n 1-12) or quarter (n 1-4), with a year");
      }
      const { from, to } = periodRange(kind, year, n);
      // Approved tasks whose ORIGINAL due date is in the period; admins never own tasks, but filter to be sure.
      const tasks: Row[] = must(await db.from("tasks")
        .select("id, owner, tags, owner_profile:profiles!tasks_owner_fkey(role, staff_name, display_name)")
        .eq("state", "approved").gte("due_on", from).lte("due_on", to))
        .filter((t: Row) => t.owner_profile?.role === "member");
      const sends: Row[] = tasks.length
        ? must(await db.from("task_sends").select("task_id, sent_on, due_on, outcome").in("task_id", tasks.map((t) => t.id)).order("sent_at"))
        : [];
      const scored: ScoredTask[] = tasks.map((t) => ({
        owner: t.owner,
        tags: t.tags,
        sends: sends.filter((s) => s.task_id === t.id).map((s) => ({ sentOn: s.sent_on, dueOn: s.due_on, outcome: s.outcome })),
      }));
      const names = Object.fromEntries(tasks.map((t) => [t.owner, t.owner_profile?.staff_name || t.owner_profile?.display_name || t.owner]));
      const rows = performanceRows(scored, names); // scaled against everyone, then trimmed for members
      return { from, to, rows: me.role === "admin" ? rows : rows.filter((r) => r.line_user_id === me.line_user_id) };
    }

    case "myTasks":
      return loadTasks((q) => q.eq("owner", me.line_user_id).neq("state", "cancelled"));

    case "sendTask": {
      const id = taskId(body);
      const task = found(must(await db.from("tasks").select("id, owner, state, current_due_on").eq("id", id).maybeSingle()), "task");
      if (!canSend(task, me.line_user_id)) throw new HttpError(403, "you can only send your own task while it is On Process");
      // Guarded flip: a double tap finds the task already submitted and stops here.
      const flipped = must(await db.from("tasks").update({ state: "submitted" })
        .eq("id", id).eq("state", "on_process").select("id").maybeSingle());
      if (!flipped) throw new HttpError(409, "already sent");
      const send = await db.from("task_sends")
        .insert({ task_id: id, sent_on: today(), due_on: task.current_due_on }).select().single();
      if (send.error) {
        await db.from("tasks").update({ state: "on_process" }).eq("id", id); // undo: no pending send to review
        throw send.error;
      }
      const fileIds = Array.isArray(body.file_ids) ? body.file_ids.map(String) : [];
      if (fileIds.length) {
        // Only the sender's own, still-unattached files move; anything else is silently ignored.
        must(await db.from("files").update({ task_id: id, send_id: send.data.id })
          .in("id", fileIds).eq("owner", me.line_user_id).is("task_id", null));
      }
      return one(id);
    }
  }
  return undefined;
}

/** Admin-only actions. Returns undefined for actions it doesn't own. */
export async function adminTaskActions(action: string, body: Row, me: Me): Promise<unknown> {
  switch (action) {
    case "listMembers":
      return must(await db.from("profiles").select("line_user_id, staff_name, display_name")
        .eq("role", "member").order("staff_name"));

    case "addBuilding": {
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 200) throw new HttpError(400, "building name is required (max 200 characters)");
      return must(await db.from("buildings").upsert({ name }, { onConflict: "name" }).select("id, name").single());
    }

    case "createTask": {
      const title = checkTitle(body.title);
      const tags = checkTags(body.tags);
      const due_on = String(body.due_on ?? "");
      if (!DATE.test(due_on)) throw new HttpError(400, "due date is required");
      if (due_on < today()) throw new HttpError(400, "due date can't be in the past");
      const building_id = Number(body.building_id);
      found(must(await db.from("buildings").select("id").eq("id", building_id).maybeSingle()), "building");
      const owners: string[] = Array.isArray(body.owners) ? [...new Set(body.owners.map(String))] : [];
      if (!owners.length) throw new HttpError(400, "pick at least one member");
      const members = must(await db.from("profiles").select("line_user_id").in("line_user_id", owners).eq("role", "member"));
      if (members.length !== owners.length) throw new HttpError(400, "tasks can only be assigned to members (not admins)");
      const details = String(body.details ?? "").trim() || null;
      const rows = must(await db.from("tasks").insert(owners.map((owner) => ({
        building_id, title, details, tags, owner, due_on, current_due_on: due_on, created_by: me.line_user_id,
      }))).select("id"));
      return loadTasks((q) => q.in("id", rows.map((r: Row) => r.id)));
    }

    case "listTasks":
      return loadTasks((q) => {
        if (body.owner) q = q.eq("owner", String(body.owner));
        if (body.building_id) q = q.eq("building_id", Number(body.building_id));
        if (body.state) q = q.eq("state", String(body.state));
        if (body.overdue) q = q.eq("state", "on_process").lt("current_due_on", today());
        return q;
      });

    case "reviewTask": {
      const id = taskId(body);
      let input;
      try {
        input = validateReview({ decision: String(body.decision ?? ""), note: body.note, nextDueOn: body.next_due_on }, today());
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      const task = found(must(await db.from("tasks").select("id, fix_round").eq("id", id).maybeSingle()), "task");
      const fx = reviewEffect(input.decision, input.nextDueOn);
      // Guarded: only one admin's review can win; the other gets 409.
      const updated = must(await db.from("tasks").update({
        state: fx.taskState,
        fix_round: task.fix_round + fx.fixRoundDelta,
        ...(fx.newDueOn ? { current_due_on: fx.newDueOn } : {}),
      }).eq("id", id).eq("state", "submitted").select("id").maybeSingle());
      if (!updated) throw new HttpError(409, "already reviewed by another admin");
      must(await db.from("task_sends").update({
        outcome: fx.sendOutcome, fix_note: input.note, next_due_on: input.nextDueOn,
        reviewed_by: me.line_user_id, reviewed_at: new Date().toISOString(),
      }).eq("task_id", id).eq("outcome", "pending"));
      return one(id);
    }

    case "editTask": {
      const id = taskId(body);
      const sends = must(await db.from("task_sends").select("id").eq("task_id", id).limit(1));
      if (sends.length) throw new HttpError(409, "a task can only be edited before its first send");
      const patch: Row = {};
      if (body.title !== undefined) patch.title = checkTitle(body.title);
      if (body.details !== undefined) patch.details = String(body.details ?? "").trim() || null;
      if (body.tags !== undefined) patch.tags = checkTags(body.tags);
      if (body.building_id !== undefined) {
        patch.building_id = found(must(await db.from("buildings").select("id").eq("id", Number(body.building_id)).maybeSingle()), "building").id;
      }
      if (body.due_on !== undefined) {
        if (!DATE.test(String(body.due_on))) throw new HttpError(400, "due date is required");
        patch.due_on = patch.current_due_on = String(body.due_on);
      }
      if (!Object.keys(patch).length) return one(id);
      found(must(await db.from("tasks").update(patch).eq("id", id).eq("state", "on_process").select("id").maybeSingle()), "task");
      return one(id);
    }

    case "cancelTask": {
      const id = taskId(body);
      found(must(await db.from("tasks").update({ state: "cancelled" })
        .eq("id", id).in("state", ["on_process", "submitted"]).select("id").maybeSingle()), "open task");
      await db.from("task_sends").update({ outcome: "void" }).eq("task_id", id).eq("outcome", "pending");
      return one(id);
    }
  }
  return undefined;
}
