// Task actions (spec "Button A"). Data lives in the Google Sheet (sheet.ts); rules live in review.ts / scoring.ts / sheetRows.ts.
import { bangkokDate, periodRange } from "./dates.ts";
import { canSend, checkDueDate, reviewEffect, TAGS, validateReview, validFileIds } from "./review.ts";
import { periodCount, performanceRows, type ScoredTask, taskParts, visibleRows, workInPeriod } from "./scoring.ts";
import { batch, isUnknownOp, loadBuildingRows, scriptTooOld, loadBuildings, loadPeople, loadSheet, type SheetData, sheet, type Step, syncMembers } from "./sheet.ts";
import { isAllBuildings, outsideResponsibility } from "./responsibility.ts";
import { freeName } from "./invoices.ts";
import { archiveFiles, base64 } from "./archive.ts";
import { taskFolderName } from "./driveName.ts";
import { driveFileLinks, type DriveFile, dropCopies } from "./driveCopy.ts";
import { notifyNewTasks } from "./notify-api.ts";
import type { BubbleTask } from "./linebot.ts";
import { recentTaskKeys, scoredSends, type Task, taskCells, taskKey } from "./sheetRows.ts";
import { bucket, db, found, HttpError, MAX_BYTES, type Me, MIME_EXT, must } from "./shared.ts";

const today = () => bangkokDate(new Date());
const dueDate = (s: unknown) => { try { return checkDueDate(s, today()); } catch (e) { throw new HttpError(400, (e as Error).message); } };

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Tasks matching `pred`, with their sends and (signed) files. One sheet read + one files query. */
async function loadTasks(pred: (t: Task) => boolean, data?: SheetData): Promise<Row[]> {
  const { tasks, sends } = data ?? await loadSheet();
  const picked = tasks.filter(pred).sort((a, b) => a.current_due_on.localeCompare(b.current_due_on));
  if (!picked.length) return [];
  const files: Row[] = must(await db.from("files").select("id, task_id, send_id, name, mime, size, path, deleted_at, drive_url")
    .in("task_id", picked.map((t) => t.id)));
  const live = files.filter((f) => !f.deleted_at);
  const urls = live.length ? must(await bucket.createSignedUrls(live.map((f) => f.path), 3600)) : [];
  const urlOf = new Map(live.map((f, i) => [f.id, urls[i]?.signedUrl]));
  const mine = sends.filter((s) => picked.some((t) => t.id === s.task_id));
  // how each send was delivered (paper / drive); sends from before this choice existed have none
  const how = new Map<number, string>(mine.length
    ? must(await db.from("send_delivery").select("send_id, delivery").in("send_id", mine.map((s) => s.id))).map((d: Row) => [d.send_id, d.delivery])
    : []);
  return picked.map(({ sheetRow: _r, ...t }) => ({
    ...t,
    sends: mine.filter((s) => s.task_id === t.id).sort((a, b) => a.id - b.id).map((s) => ({ ...s, delivery: how.get(s.id) ?? null })),
    files: files.filter((f) => f.task_id === t.id)
      .map(({ path: _p, ...f }) => (f.deleted_at ? { ...f, url: f.drive_url } : { ...f, url: urlOf.get(f.id) })),
  }));
}

// shortcut: re-reads the whole sheet after a write (~1-2 s); fine for ~10 users, build the reply from the write if it gets slow.
const one = async (id: number) => found((await loadTasks((t) => t.id === id))[0] ?? null, "task");
const taskIn = (data: SheetData, id: number) => found(data.tasks.find((t) => t.id === id) ?? null, "task");

const taskId = (body: Row) => {
  const id = Number(body.task_id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "task_id is required");
  return id;
};

/** Score tags (หมวดหมู่): any of the 4, or none — a task with no tag counts in คะแนนตรงเวลา only. */
function checkTags(tags: unknown): string[] {
  if (!Array.isArray(tags) || !tags.every((t) => (TAGS as readonly string[]).includes(t))) {
    throw new HttpError(400, "tags must be from the list");
  }
  return [...new Set(tags as string[])];
}

function checkTitle(title: unknown): string {
  const t = String(title ?? "").trim();
  if (!t || t.length > 200) throw new HttpError(400, "title is required (max 200 characters)");
  return t;
}

function checkBuilding(name: unknown, buildings: string[]): string {
  const b = String(name ?? "").trim();
  if (!buildings.includes(b)) throw new HttpError(404, "building not found");
  return b;
}

/** A member (หัวหน้างาน) by staff name, as the sheet stores it; 400 when nobody has that name. */
async function memberName(name: unknown): Promise<string> {
  const n = String(name ?? "").trim();
  if (!(await loadPeople()).some((p) => p.role === "member" && p.name === n)) throw new HttpError(400, `no หัวหน้างาน named "${n}"`);
  return n;
}

/** Actions for approved members (and admins). Returns undefined for actions it doesn't own. */
const TASK_MAX_BYTES = 25 * 1024 * 1024; // the file travels base64 in one request to Apps Script (~50 MB cap)
const GENERIC_PHOTO = /^image( \(\d+\))?\.(jpe?g|png|heic|heif)$/i; // the name iPhones give every photo picked from Photos

/** Files in the task's Drive folder (oldest first) and the folder link; the script renames the folder if the task was edited. */
async function taskDrive(task: Task): Promise<{ files: Row[]; url: string | null }> {
  // script not redeployed yet: nothing can have been uploaded, so show "ไม่มีไฟล์แนบ" instead of an error
  const r = await sheet("taskFiles", { id: task.id, folder: taskFolderName(task) }, 30_000)
    .catch((e) => { if (isUnknownOp(e)) return { files: [], url: null }; throw e; });
  return { files: ((r.files ?? []) as Row[]).sort((a, b) => a.modified.localeCompare(b.modified)), url: r.url ?? null };
}

/** The task, if `me` owns it or is an admin. */
function seeTask(data: SheetData, id: number, me: Me): Task {
  const task = taskIn(data, id);
  if (task.owner !== me.line_user_id && me.role !== "admin") throw new HttpError(403, "not your task");
  return task;
}

/** Admin attachments of a task, oldest first; [] until the script is redeployed. */
async function briefFiles(task: Task): Promise<DriveFile[]> {
  const r = await sheet("briefFiles", { id: task.id }, 30_000).catch((e) => { if (isUnknownOp(e)) return { files: [] }; throw e; });
  return ((r.files ?? []) as DriveFile[]).sort((a, b) => a.modified.localeCompare(b.modified));
}

/** Files change only on your own task while it is open (กำลังดำเนินการ, including a fix round). */
function ownOpenTask(data: SheetData, id: number, me: Me): Task {
  const task = taskIn(data, id);
  if (task.owner !== me.line_user_id || task.state !== "on_process") {
    throw new HttpError(403, "แนบ / ลบไฟล์ได้เฉพาะงานของคุณที่กำลังดำเนินการ · only your own task while on process");
  }
  return task;
}

export async function memberTaskActions(action: string, body: Row, me: Me): Promise<unknown> {
  switch (action) {
    case "listBuildings": // with owner, so the assign form can show only the chosen person's buildings
      return (await loadBuildingRows()).map(({ name, owner }) => ({ name, owner }));

    case "performance": {
      const kind = body.kind === "quarter" ? "quarter" : body.kind === "month" ? "month" : null;
      const year = Number(body.year), n = Number(body.n);
      if (!kind || !Number.isInteger(year) || !Number.isInteger(n) || n < 1 || n > (kind === "month" ? 12 : 4)) {
        throw new HttpError(400, "kind must be month (n 1-12) or quarter (n 1-4), with a year");
      }
      const { from, to } = periodRange(kind, year, n);
      const data = await loadSheet();
      const role = new Map(data.people.map((p) => [p.line_user_id, p]));
      // Approved in the period -> full score; older tasks still not approved and late -> คะแนนตรงเวลา only (periodCount).
      // Revoked people still count; admins never own tasks.
      const scored: ScoredTask[] = [];
      // owner -> their tasks in the period (tap a name): every task in มอบหมาย, each marked approved (counts in อนุมัติ and
      // every score) / late (คะแนนตรงเวลา only) / neither (not scored yet). So the list's length = มอบหมาย and its
      // approved rows = อนุมัติ. มอบหมาย = workInPeriod, plus any task that is scored (so a score never comes from outside it).
      const items = new Map<string, unknown[]>();
      for (const t of data.tasks) {
        if (!role.has(t.owner) || role.get(t.owner)!.role === "admin") continue;
        const rows = data.sends.filter((s) => s.task_id === t.id);
        const sends = scoredSends(t, rows);
        const ok = rows.filter((s) => s.outcome === "approved").at(-1);
        const approvedOn = t.state === "approved" ? String(ok?.reviewed_at || ok?.sent_on || t.current_due_on).slice(0, 10) : null;
        const c = periodCount({ state: t.state, createdOn: String(t.created_at).slice(0, 10), currentDue: t.current_due_on, approvedOn, sends }, from, to, today());
        const x: ScoredTask | null = c && { owner: t.owner, tags: t.tags, sends, ...(c === "full" ? {} : c) };
        const parts = x && taskParts(x);
        if (parts) scored.push(x!);
        if (!parts && !workInPeriod({ state: t.state, firstDue: t.due_on, approvedOn }, from, to)) continue;
        const real = rows.filter((s) => s.outcome !== "void");
        items.set(t.owner, [...(items.get(t.owner) ?? []), {
          id: t.id, title: t.title, building: t.building, state: t.state, fix_round: t.fix_round,
          due_on: t.due_on, current_due_on: t.current_due_on, last_sent_on: real.at(-1)?.sent_on ?? null,
          fixes: real.filter((s) => s.outcome === "fix").length,
          counts: parts ? (parts.approved ? "approved" : "late") : "none",
          ...(parts ?? { approved: false, onTime: null, byTag: {}, daysLate: 0 }),
        }]);
      }
      const assigned = new Map([...items].map(([owner, list]) => [owner, list.length]));
      const names = Object.fromEntries(scored.map((x) => [x.owner, role.get(x.owner)!.name]));
      const rows = performanceRows(scored, names).map((r) => ({ ...r, assigned: assigned.get(r.line_user_id) ?? 0 })); // scaled against everyone, then trimmed for members
      // people with tasks assigned in the period but nothing scored yet: a row with their counts, no scores
      for (const [owner, n] of assigned) {
        const p = role.get(owner);
        if (!p || p.role === "admin" || rows.some((r) => r.line_user_id === owner)) continue;
        rows.push({ line_user_id: owner, name: p.name, tasks: 0, assigned: n, overall: null, overall5: null, onTime: null, onTime5: null, byTag: {} } as unknown as typeof rows[number]);
      }
      // members: their own row (and task list) only, filtered here on the server
      return { from, to, rows: visibleRows(rows, me).map((r) => ({ ...r, items: items.get(r.line_user_id) ?? [] })) };
    }

    case "myTasks": // score tags are for admins only: members never get them
      return (await loadTasks((t) => t.owner === me.line_user_id && t.state !== "cancelled")).map((t) => ({ ...t, tags: [] }));

    // Task files: the owner uploads (any type) to the task's own Drive folder <main>/<taskFolderName>/; admins open it in Drive.
    case "taskFiles": {
      const task = taskIn(await loadSheet(), taskId(body));
      if (task.owner !== me.line_user_id && me.role !== "admin") throw new HttpError(403, "not your task");
      return taskDrive(task);
    }

    case "uploadTaskFile": {
      const task = ownOpenTask(await loadSheet(), taskId(body), me);
      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, "no file");
      if (!file.size) throw new HttpError(400, "file is empty");
      if (file.size > TASK_MAX_BYTES) throw new HttpError(400, "file is over 25 MB");
      let name = file.name.replace(/[\/\\\r\n]+/g, " ").trim().slice(0, 150) || "file";
      // same file name = new version: the script keeps only the newest (the old one is trashed after the new one is saved).
      // Except phone photos: iPhones name every picked photo "image.jpg", so those never replace another file.
      if (GENERIC_PHOTO.test(name)) name = freeName(name, (await taskDrive(task)).files.map((f) => String(f.name)));
      await sheet("taskUpload", {
        id: task.id, folder: taskFolderName(task), name, mime: file.type || "application/octet-stream",
        base64: base64(new Uint8Array(await file.arrayBuffer())),
      }, 90_000).catch(scriptTooOld);
      return taskDrive(task);
    }

    // ไฟล์จากแอดมิน: files an admin attached when assigning / sending back; the owner (and admins) view and print them only
    case "briefFiles":
      return briefFiles(seeTask(await loadSheet(), taskId(body), me));

    case "briefFileUrl": {
      const task = seeTask(await loadSheet(), taskId(body), me);
      const file = (await briefFiles(task)).find((f) => f.id === String(body.fileId ?? ""));
      if (!file) throw new HttpError(404, "file not found");
      return driveFileLinks(file, async () => (await sheet("briefFileData", { id: task.id, fileId: file.id }, 60_000)).base64);
    }

    case "deleteTaskFile": {
      const task = ownOpenTask(await loadSheet(), taskId(body), me);
      await sheet("taskFileDelete", { id: task.id, fileId: String(body.fileId ?? "") }); // to Drive's trash
      return taskDrive(task);
    }

    case "sendTask": {
      const id = taskId(body);
      await submitTask(id, me.line_user_id, body.delivery, validFileIds(body.file_ids)); // non-uuids dropped: a bad id must not 500 after the send is saved
      return { ...await one(id), tags: [] }; // no score tags for members
    }
  }
  return undefined;
}

export const DELIVERY = ["paper", "drive"] as const; // ส่งเอกสารตัวจริง / ส่งไฟล์ออนไลน์ (Drive)
export const PICK_DELIVERY = "กรุณาส่งงานในแอป และเลือกวิธีส่งเอกสาร: ส่งเอกสารตัวจริง หรือ ส่งไฟล์ออนไลน์ (Drive)";

/**
 * ส่งงาน: the web app's button and the LINE bubble's button both land here. Throws 404 (no task),
 * 403 (not this person's on-process task), 409 (already sent) or 400 (no delivery picked; 'drive' without a file
 * uploaded since the previous send). Returns the task as it was before sending.
 */
export async function submitTask(id: number, userId: string, delivery: unknown, fileIds: string[] = []): Promise<Task> {
  const data = await loadSheet();
  const task = taskIn(data, id);
  if (!canSend(task, userId)) throw new HttpError(403, "you can only send your own task while it is กำลังดำเนินการ (on process)");
  if (!(DELIVERY as readonly unknown[]).includes(delivery)) throw new HttpError(400, PICK_DELIVERY);
  if (delivery === "drive") {
    // a file for THIS send: on a fix round the folder still holds the earlier send's files
    const prev = data.sends.filter((s) => s.task_id === id).map((s) => s.sent_at).sort().at(-1) ?? "";
    const { files } = await taskDrive(task);
    if (!files.some((f) => !prev || String(f.modified) > prev)) {
      throw new HttpError(400, prev ? "เลือกส่งไฟล์ออนไลน์: แนบไฟล์ใหม่ของรอบนี้ก่อน แล้วกดส่งงาน" : "เลือกส่งไฟล์ออนไลน์: แนบไฟล์ก่อน แล้วกดส่งงาน");
    }
  }
  // One locked batch: the flip and the send row land together; a double tap finds state != on_process and gets 409.
  const r = await batch([
    { op: "update", tab: "Tasks", id, patch: { state: "submitted" }, expect: { state: "on_process" } },
    { op: "append", tab: "Sends", rows: [{
      task_id: String(id), sent_on: today(), sent_at: new Date().toISOString(), due_on: task.current_due_on, outcome: "pending",
    }] },
  ]);
  if (!r) throw new HttpError(409, "already sent");
  const { error } = await db.from("send_delivery").insert({ send_id: Number(r[1][0].id), delivery });
  if (error) console.error("send_delivery", error); // the send itself is saved; only its label is missing
  if (fileIds.length) {
    // Only the sender's own, still-unattached files move; anything else is silently ignored.
    const moved: Row[] = must(await db.from("files").update({ task_id: id, send_id: Number(r[1][0].id) })
      .in("id", fileIds).eq("owner", userId).is("task_id", null).select("id"));
    // Awaited (the function may stop once it replies); a Drive hiccup never fails the send, the daily cleanup retries.
    await archiveFiles(moved.map((f) => f.id), new Map([[id, task]])).catch((e) => console.error("archive", e));
  }
  return task;
}

/** Admin-only actions. Returns undefined for actions it doesn't own. */
export async function adminTaskActions(action: string, body: Row, me: Me): Promise<unknown> {
  switch (action) {
    case "listMembers": {
      // Every admin page open refreshes the sheet's Members tab; a sheet hiccup must not break the page.
      // Awaited: the function may stop as soon as it replies, which would drop a background write.
      await loadPeople().then(syncMembers).catch((e) => console.error("syncMembers", e));
      return must(await db.from("profiles").select("line_user_id, staff_name, display_name")
        .eq("role", "member").order("staff_name"));
    }

    case "sheetWarnings":
      return (await loadSheet()).bad;

    case "addBuilding": {
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 200) throw new HttpError(400, "building name is required (max 200 characters)");
      // owner = the one หัวหน้างาน picked in the assign form, so the new building is in their list straight away
      const owner = body.owner_name ? await memberName(body.owner_name) : "";
      if (!(await loadBuildings()).includes(name)) await sheet("append", { tab: "Buildings", rows: [{ name, owner }] });
      return { name, owner };
    }

    case "listResponsibilities": {
      // ข้อมูลการมอบหมาย: every หัวหน้างาน (member) and every building with its owner
      // "ทุกนิติ" (= every building) has no owner, so it is left out of the table
      const [people, rows] = await Promise.all([loadPeople(), loadBuildingRows()]);
      const buildings = rows.filter((b) => !isAllBuildings(b.name));
      return { people: people.filter((p) => p.role === "member").map((p) => p.name).sort((a, b) => a.localeCompare(b, "th")), buildings };
    }

    case "setBuildingOwner": {
      const building = String(body.building ?? "").trim();
      if (!(await loadBuildings()).includes(building)) throw new HttpError(404, "building not found");
      const owner = body.owner_name ? await memberName(body.owner_name) : ""; // "" = no one looks after it
      await batch([{ op: "update", tab: "Buildings", key: "name", id: building, patch: { owner } }]);
      return { building, owner };
    }

    case "createTask": {
      const title = checkTitle(body.title);
      const tags = checkTags(body.tags);
      const due_on = dueDate(body.due_on);
      const data = await loadSheet();
      // one or more buildings (old pages send `building`); each person x building becomes its own task row
      const wanted: unknown[] = Array.isArray(body.buildings) ? body.buildings : [body.building];
      const buildingList = [...new Set(wanted.map((b) => checkBuilding(b, data.buildings)))];
      if (!buildingList.length) throw new HttpError(400, "pick at least one building");
      const owners: string[] = Array.isArray(body.owners) ? [...new Set(body.owners.map(String))] : [];
      if (!owners.length) throw new HttpError(400, "pick at least one member");
      const picked = owners.map((id) => data.people.find((p) => p.line_user_id === id));
      if (picked.some((p) => !p || p.role !== "member")) throw new HttpError(400, "tasks can only be assigned to members (not admins)");
      for (const p of picked) {
        // owner_name is how the sheet names the owner, so it must be unique.
        if (data.people.filter((q) => q.name === p!.name).length > 1) throw new HttpError(400, `two people are named "${p!.name}"; give one a different staff name first`);
      }
      if (picked.length * buildingList.length > 100) throw new HttpError(400, "too many tasks at once (max 100 person × building)");
      // ข้อมูลการมอบหมาย: a building can only go to the หัวหน้างาน who looks after it (every pair is checked)
      const rowsB = await loadBuildingRows();
      for (const building of buildingList) {
        const outside = outsideResponsibility(building, picked.map((p) => p!.name), rowsB);
        if (outside) throw new HttpError(400, `"${building}" ไม่อยู่ในความรับผิดชอบของ ${outside} · not in ${outside}'s buildings`);
      }
      const details = String(body.details ?? "").trim() || null;
      const created_at = new Date().toISOString();
      // double submit guard: the same person + building + title + due date this admin created in the last 2 minutes is skipped
      const recent = recentTaskKeys(data.tasks, me.line_user_id, Date.now());
      const pairs = picked.flatMap((p) => buildingList.map((building) => ({ p: p!, building })))
        .filter(({ p, building }) => !recent.has(taskKey(p.line_user_id, building, title, due_on)));
      if (!pairs.length) throw new HttpError(409, "เพิ่งมอบหมายงานนี้ไปแล้ว · this task was just assigned (duplicate)");
      const [rows] = (await batch([{ op: "append", tab: "Tasks", rows: pairs.map(({ p, building }) => taskCells({
        building, title, details, tags, owner: p.line_user_id, owner_name: p.name, state: "on_process", due_on,
        current_due_on: "", fix_round: 0, created_by: me.line_user_id, created_at, member_notified_at: null,
      })) }]))!; // all rows in one locked batch: all or nothing
      const ids = new Set(rows.map((r: Row) => Number(r.id)));
      // instant LINE bubble (08:30–17:30 only; otherwise pendingNotices sends it once working hours start): one push per person; a LINE problem never undoes the assignment
      try {
        const byOwner = new Map<string, BubbleTask[]>();
        for (const r of rows as Row[]) {
          byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), { id: Number(r.id), title: r.title, building: r.building, details: r.details || null, due: r.due_on }]);
        }
        const sent = await notifyNewTasks([...byOwner].map(([to, tasks]) => ({ to, tasks })));
        if (sent.length) {
          const at = new Date().toISOString();
          await batch(sent.map((id) => ({ op: "update" as const, tab: "Tasks", id, patch: { member_notified_at: at } })));
        }
      } catch (e) { console.error("instant notice", e); }
      return loadTasks((t) => ids.has(t.id));
    }

    case "uploadBriefFile": { // admin attachment (assign / send back): PDF or picture, so members can view and print it in the app
      const task = taskIn(await loadSheet(), taskId(body));
      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, "no file");
      if (!MIME_EXT[file.type]) throw new HttpError(400, "แนบได้เฉพาะ PDF หรือรูป (JPG, PNG, WEBP) เพื่อให้สมาชิกเปิดดูและพิมพ์ในแอปได้");
      if (file.size > MAX_BYTES) throw new HttpError(400, "file is over 10 MB");
      const name = file.name.replace(/[\/\\\r\n]+/g, " ").trim().slice(0, 150) || "file";
      const { replaced = [] } = await sheet("briefUpload", {
        id: task.id, folder: taskFolderName(task), name, mime: file.type, base64: base64(new Uint8Array(await file.arrayBuffer())),
      }, 60_000).catch(scriptTooOld);
      await Promise.all((replaced as string[]).map(dropCopies)); // same name = new version
      return briefFiles(task);
    }

    case "listTasks":
      return loadTasks((t) =>
        (!body.owner || t.owner === String(body.owner)) &&
        // "ทุกนิติ" and "ทุกนิติบุคคล" mean the same (every building): filtering by one finds both
        (!body.building || t.building === String(body.building) || (isAllBuildings(String(body.building)) && isAllBuildings(t.building))) &&
        (!body.state || t.state === String(body.state)) &&
        (!body.overdue || (t.state === "on_process" && t.current_due_on < today())));

    case "reviewTask": {
      const id = taskId(body);
      let input;
      try {
        input = validateReview({ decision: String(body.decision ?? ""), note: body.note, nextDueOn: body.next_due_on }, today());
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      const data = await loadSheet();
      const task = taskIn(data, id);
      if (task.state !== "submitted") throw new HttpError(409, "already reviewed by another admin");
      const pending = data.sends.filter((s) => s.task_id === id && s.outcome === "pending").at(-1);
      const fx = reviewEffect(input.decision, input.nextDueOn);
      // Task and send change in one locked batch: only one admin's review can win, the other gets 409.
      const steps: Step[] = [{
        op: "update", tab: "Tasks", id, expect: { state: "submitted" },
        patch: { state: fx.taskState, fix_round: String(task.fix_round + fx.fixRoundDelta), ...(fx.newDueOn ? { current_due_on: fx.newDueOn } : {}) },
      }];
      if (pending) {
        steps.push({
          op: "update", tab: "Sends", id: pending.id, expect: { outcome: "pending" },
          patch: { outcome: fx.sendOutcome, fix_note: input.note ?? "", next_due_on: input.nextDueOn ?? "",
            reviewed_by: me.line_user_id, reviewed_at: new Date().toISOString() },
        });
      }
      if (!await batch(steps)) throw new HttpError(409, "already reviewed by another admin");
      return one(id);
    }

    case "editTask": {
      const id = taskId(body);
      const data = await loadSheet();
      const task = taskIn(data, id);
      if (data.sends.some((s) => s.task_id === id)) throw new HttpError(409, "a task can only be edited before its first send");
      const patch: Partial<Task> = {};
      if (body.title !== undefined) patch.title = checkTitle(body.title);
      if (body.details !== undefined) patch.details = String(body.details ?? "").trim() || null;
      if (body.tags !== undefined) patch.tags = checkTags(body.tags);
      if (body.building !== undefined) patch.building = checkBuilding(body.building, data.buildings);
      if (body.due_on !== undefined) patch.due_on = dueDate(body.due_on); // current_due_on stays blank = follows due_on
      if (!Object.keys(patch).length) return one(id);
      if (task.state !== "on_process" ||
        !await batch([{ op: "update", tab: "Tasks", id, patch: taskCells(patch), expect: { state: "on_process" } }])) {
        throw new HttpError(404, "task not found");
      }
      return one(id);
    }

    case "resendNotice": {
      // tracking page 📨: push this task's new-task card again now (any time), then mark it notified
      const id = taskId(body);
      const t = taskIn(await loadSheet(), id);
      if (t.state !== "on_process") throw new HttpError(409, "แจ้งซ้ำได้เฉพาะงานที่กำลังดำเนินการ · only open tasks");
      const sent = await notifyNewTasks([{ to: t.owner, tasks: [{ id, title: t.title, building: t.building, details: t.details, due: t.current_due_on }] }], true);
      if (!sent.length) throw new HttpError(502, "ส่ง LINE ไม่สำเร็จ (ตรวจ token หรือโควตาข้อความ ในหน้าตั้งค่า)");
      await batch([{ op: "update", tab: "Tasks", id, patch: { member_notified_at: new Date().toISOString() } }]);
      return one(id);
    }

    case "cancelTask": {
      const id = taskId(body);
      const data = await loadSheet();
      const task = taskIn(data, id);
      if (task.state !== "on_process" && task.state !== "submitted") throw new HttpError(404, "open task not found");
      const steps: Step[] = [{ op: "update", tab: "Tasks", id, patch: { state: "cancelled" }, expect: { state: task.state } }];
      for (const s of data.sends.filter((s) => s.task_id === id && s.outcome === "pending")) {
        steps.push({ op: "update", tab: "Sends", id: s.id, patch: { outcome: "void" }, expect: { outcome: "pending" } });
      }
      if (!await batch(steps)) throw new HttpError(409, "the task just changed; reload and try again");
      return one(id);
    }
  }
  return undefined;
}
