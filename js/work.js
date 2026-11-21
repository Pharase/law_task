// Member Work dashboard (spec "Member view"). Needs js/app.js (api, uploadFile, $).
const OUTCOME_TEXT = { pending: "รอตรวจ", approved: "อนุมัติ", void: "กดผิด", fix: "มีปรับแก้" };
// how a send was delivered (picked when pressing ส่งงาน); older sends have none
const DELIVERY_TEXT = { paper: "📄 เอกสารตัวจริง", drive: "☁️ ไฟล์ออนไลน์ (Drive)" };
const deliveryNote = (s) => (DELIVERY_TEXT[s.delivery] ? " · " + DELIVERY_TEXT[s.delivery] : "");
// history line's outcome (รอตรวจ / อนุมัติ / ...) in neon, one colour per outcome (css .outcome-neon)
const outcomeTag = (s) => el("span", { className: "outcome-neon " + s.outcome, textContent: OUTCOME_TEXT[s.outcome] ?? s.outcome });
const bkkToday =() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
// Bangkok day of a timestamp ("" for none)
const bkkDay = (iso) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso)) : "");

const dayDiff = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5); // yyyy-mm-dd strings

/** C · where a task is: step 0-3 of มอบหมาย → ส่งงาน → ตรวจ → อนุมัติ (4 = all done), a colour, and one word with the days that matter. */
function taskStatus(t) {
  const today = bkkToday();
  if (t.state === "cancelled") return { step: -1, k: "dim", word: "ยกเลิก" };
  if (t.state === "approved") {
    const ok = t.sends.filter((s) => s.outcome === "approved").at(-1);
    return { step: 4, k: "green", word: "อนุมัติ" + (ok ? " " + thDate(ok.reviewed_at ? bkkDay(ok.reviewed_at) : ok.sent_on) : "") };
  }
  if (t.state === "submitted") return { step: 2, k: "yellow", word: `รอตรวจ ${dayDiff(t.sends.at(-1)?.sent_on ?? today, today)} วัน` };
  const left = dayDiff(today, t.current_due_on);
  if (left < 0) return { step: 1, k: "red", word: `เลยกำหนด ${-left} วัน` };
  return { step: 1, k: t.fix_round ? "orange" : "cyan", word: `${t.fix_round ? "กำลังแก้" : "กำลังทำ"} · ${left ? `อีก ${left} วัน` : "ครบกำหนดวันนี้"}` };
}

/** C · status strip on every task row: a 4-part mini bar and the status word, in the status colour. */
function statusStrip(t) {
  const s = taskStatus(t);
  const bar = el("span", { className: "mini", ariaHidden: "true" },
    ...[0, 1, 2, 3].map((i) => el("i", { className: s.step === 4 || i < s.step ? "on" : i === s.step ? "now" : "" })));
  return el("span", { className: `strip k-${s.k}` }, bar, el("span", { className: "strip-word", textContent: s.word }));
}

/**
 * B · the task's story in order: assigned, each send (on time, or N days late against that round's due date), each
 * review, then the due date still ahead (dashed) or how late it is now.
 */
function journey(t) {
  const today = bkkToday();
  const ev = [{ d: bkkDay(t.created_at), k: "cyan", main: "มอบหมายงาน", sub: `กำหนดส่ง ${thDate(t.due_on)}` }];
  t.sends.forEach((s, i) => {
    const late = s.due_on ? dayDiff(s.due_on, s.sent_on) : null;
    ev.push({ d: s.sent_on, k: "pink", main: i ? `ส่งงาน ครั้งที่ ${i + 1}` : "ส่งงาน", sub: DELIVERY_TEXT[s.delivery] ?? "",
      tag: late === null ? null : late > 0 ? ["red", `ช้า ${late} วัน`] : ["green", "ตรงเวลา"] });
    const on = s.reviewed_at ? bkkDay(s.reviewed_at) : s.sent_on; // lines set by hand have no review time
    if (s.outcome === "fix") ev.push({ d: on, k: "orange", main: "ส่งกลับแก้ไข", sub: `กำหนดใหม่ ${thDate(s.next_due_on)}`, note: s.fix_note });
    else if (s.outcome === "void") ev.push({ d: on, k: "dim", main: "กดผิด (ไม่นับการส่งนี้)", note: s.fix_note });
    else if (s.outcome === "approved") ev.push({ d: on, k: "green", main: "อนุมัติ", note: s.fix_note });
    else ev.push({ d: today, k: "yellow", now: true, main: "รอตรวจ", sub: `รอมา ${dayDiff(s.sent_on, today)} วัน` });
  });
  if (t.state === "on_process") {
    const left = dayDiff(today, t.current_due_on);
    ev.push(left < 0
      ? { d: t.current_due_on, k: "red", now: true, main: `เลยกำหนด ${-left} วัน` }
      : { d: t.current_due_on, k: "cyan", now: true, ghost: true, main: "กำหนดส่ง", sub: left ? `อีก ${left} วัน` : "วันนี้" });
  }
  if (t.state === "cancelled") ev.push({ d: "", k: "dim", main: "ยกเลิกงาน" });
  return el("ol", { className: "journey" }, ...ev.map((e) => el("li", { className: `k-${e.k}${e.now ? " now" : ""}` },
    el("span", { className: "j-date", textContent: e.d ? thDate(e.d) : "" }),
    el("span", { className: "j-dot" + (e.ghost ? " ghost" : ""), ariaHidden: "true" }),
    el("div", { className: "j-text" },
      el("strong", { textContent: e.main }),
      e.tag && el("span", { className: `j-tag k-${e.tag[0]}`, textContent: e.tag[1] }),
      e.sub && el("span", { className: "muted", textContent: " · " + e.sub }),
      e.note && el("div", { className: "muted pre", textContent: e.note })))));
}

// dd/mm/yyyy in the Buddhist year (same format as the date boxes, see dateText in app.js)
const thDate = (s) => (s ? dateText(String(s).slice(0, 10)) : "-");

// Build elements with textContent only, never innerHTML (titles and notes are user input).
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return e;
}

function lastFix(task) {
  const fixes = task.sends.filter((s) => s.outcome === "fix");
  return fixes.at(-1) ?? null;
}

// opts.status: status text shown as a tag; opts.admin: show the owner and no Send controls (admins don't own tasks).
function taskItem(task, today, onChange, opts = {}) {
  const overdue = task.state === "on_process" && task.current_due_on < today; // the card's red edge (css .task.overdue)
  const fix = task.state === "on_process" ? lastFix(task) : null;
  const summary = el("summary", {},
    statusStrip(task), // where it is at a glance (overdue days included, so no separate เลยกำหนด badge)
    el("strong", { textContent: task.title }),
    el("span", { className: "muted", textContent: ` · ${task.building}${opts.admin ? " · " + task.owner_name : ""}` }),
    // hidden once the card is open: the detail shows the due date under the tags instead
    el("span", { className: "muted nowrap due-head", textContent: ` · กำหนดส่ง ${thDate(task.current_due_on)}` }),
    opts.status && el("span", { className: "badge", textContent: opts.status }),
    task.fix_round > 0 && el("span", { className: "badge", textContent: `รอบแก้ ${task.fix_round}` }),
    task.fix_round > 5 && el("span", { className: "badge late", textContent: "เกิน 5 รอบแก้ไข" }),
  );

  const body = el("div", { className: "task-body" },
    task.details && el("p", { className: "pre", textContent: task.details }),
    task.tags.length > 0 && el("p", {}, ...task.tags.map((t) => el("span", { className: "tag", textContent: t }))), // members get none (server)
    // due date glows; the original date shows only after a send-back moved it (มีปรับแก้). nowrap: a label never splits from its date
    el("p", { className: "due-line" },
      el("span", { className: "nowrap" }, "กำหนดส่ง ", el("span", { className: "due-neon", textContent: thDate(task.current_due_on) })),
      task.current_due_on !== task.due_on && el("span", { className: "nowrap" }, " · กำหนดส่งเดิม ", el("span", { className: "due-neon old", textContent: thDate(task.due_on) }))),
    fix && el("div", { className: "fix-note" },
      el("strong", { textContent: "สิ่งที่ต้องแก้ไข: " }), el("span", { className: "pre", textContent: fix.fix_note ?? "" })),
  );

  // ไฟล์จากแอดมิน (attached when assigning / sending back): view and print only; loaded when the card is opened
  const brief = !opts.admin && briefBox(task);
  if (brief) body.append(brief.box);

  body.append(el("p", { className: "label", textContent: "ความคืบหน้า" }), journey(task));

  if (task.files.length) {
    body.append(el("p", { className: "label", textContent: "ไฟล์แนบ" }), el("ul", {},
      ...task.files.map((f) => el("li", {}, f.url
        ? el("a", { href: f.url, target: "_blank", textContent: f.name })
        : el("span", { className: "muted", textContent: `${f.name} (ลบหลังสำรองข้อมูลแล้ว)` })))));
  }

  // the owner's files for this task, in its own Drive folder; loaded the first time the card is opened
  const files = !opts.admin && taskFilesBox(task);
  if (files) body.append(files.box);

  if (task.state === "on_process" && !opts.admin) {
    const msg = el("p", { role: "status" });
    // required: paper document, or files in the task's Drive folder (uploaded above; the server checks there is one for this send)
    const name = "delivery-" + task.id;
    const choice = el("fieldset", { className: "delivery" }, el("legend", { textContent: "วิธีส่งเอกสาร (เลือก 1 อย่าง)" }),
      ...Object.entries({ paper: "📄 ส่งเอกสารตัวจริง", drive: "☁️ ส่งไฟล์ออนไลน์ (Drive) · แนบไฟล์ด้านบนก่อน" }).map(([value, text]) =>
        el("label", { className: "inline" }, el("input", { type: "radio", name, value }), " " + text)));
    const btn = el("button", { type: "button", textContent: "ส่งงาน (Send)" });
    btn.onclick = async () => {
      const delivery = choice.querySelector("input:checked")?.value;
      if (!delivery) return void (msg.textContent = "เลือกวิธีส่งเอกสารก่อน: ส่งเอกสารตัวจริง หรือ ส่งไฟล์ออนไลน์");
      if (delivery === "drive" && files && files.count() === 0) return void (msg.textContent = "เลือกส่งไฟล์ออนไลน์: แนบไฟล์ก่อน แล้วกดส่งงาน");
      btn.disabled = true;
      try {
        msg.textContent = "กำลังส่ง…";
        await api("sendTask", { task_id: task.id, delivery, file_ids: [] });
        onChange();
      } catch (err) {
        msg.textContent = "Error: " + err.message;
        btn.disabled = false;
      }
    };
    body.append(choice, btn, msg);
  }

  const item = el("details", { className: "task" + (overdue ? " overdue" : "") }, summary, body);
  item.dataset.task = task.id;
  if (files) item.addEventListener("toggle", () => { if (item.open) { files.load(); brief.load(); } });
  return item;
}

/** Admin attachments of a task for its owner: 👁️ view and 🖨️ print (viewLinked / printLinked in app.js). Hidden when none. */
function briefBox(task) {
  const box = el("div", { className: "task-files", hidden: true });
  const msg = el("p", { className: "muted small-note upload-msg", role: "status" });
  let loaded = false;
  const links = (f) => () => api("briefFileUrl", { task_id: task.id, fileId: f.id });
  const icon = (f) => (f.mime === "application/pdf" ? "📄 " : "🖼️ ");
  return {
    box,
    load() {
      if (loaded) return;
      loaded = true;
      api("briefFiles", { task_id: task.id }).then((files) => {
        box.hidden = !files.length;
        box.replaceChildren(el("p", { className: "label", textContent: "ไฟล์จากแอดมิน" }),
          ...files.map((f) => el("div", { className: "inv-file" },
            el("span", { className: "inv-file-name", textContent: icon(f) + f.name }),
            el("button", { type: "button", className: "icon-btn", textContent: "👁️", title: "ดู", ariaLabel: "ดู " + f.name, onclick: (e) => viewLinked(links(f), e.currentTarget, msg) }),
            el("button", { type: "button", className: "icon-btn", textContent: "🖨️", title: "พิมพ์", ariaLabel: "พิมพ์ " + f.name, onclick: (e) => printLinked(links(f), f.mime, e.currentTarget, msg) }))),
          msg);
      }, () => { loaded = false; }); // not shown on an error: the card still works, the next open tries again
    },
  };
}

/** Admin: attach files to tasks one by one (PDF / pictures); say(text) shows progress. Returns the failures as "name — why". */
async function uploadBriefFiles(taskIds, files, say) {
  const failed = [];
  let n = 0;
  for (const id of taskIds) for (const file of files) {
    say(`กำลังแนบไฟล์ ${++n}/${taskIds.length * files.length}: ${file.name}`);
    const form = new FormData();
    form.append("task_id", id);
    form.append("file", file);
    try { await api("uploadBriefFile", form); } catch (err) { failed.push(`${file.name} — ${err.message}`); }
  }
  return failed;
}

/**
 * ไฟล์งาน: any file type, max 25 MB each, uploaded one by one to <main folder>/<taskID-date-subject-member-building>/.
 * Same name = new version (Drive keeps the newest). A failed file is named and skipped; the old version stays.
 * Adding and deleting only while the task is กำลังดำเนินการ (the server checks too).
 */
function taskFilesBox(task) {
  const canEdit = task.state === "on_process";
  const box = el("div", { className: "task-files" });
  const msg = el("p", { className: "muted small-note upload-msg", role: "status" });
  let loaded = false, shown = -1;
  const fail = (err) => { msg.textContent = "❌ " + err.message; };
  const draw = ({ files }) => (shown = files.length, box.replaceChildren(
    el("p", { className: "label", textContent: canEdit ? "แนบไฟล์งาน (แนบก่อน แล้วกดส่งงาน)" : "ไฟล์งาน" }),
    files.length
      ? el("div", {}, ...files.map((f) => el("div", { className: "inv-file" },
        el("span", { className: "inv-file-name", textContent: "📄 " + f.name }),
        canEdit && el("button", { type: "button", className: "icon-btn", textContent: "🗑️", title: "ลบ", ariaLabel: "ลบ " + f.name, onclick: async (e) => {
          if (!confirm(`ลบไฟล์ "${f.name}" ?`)) return;
          e.currentTarget.disabled = true;
          try { draw(await api("deleteTaskFile", { task_id: task.id, fileId: f.id })); } catch (err) { fail(err); e.currentTarget.disabled = false; }
        } }))))
      : el("p", { className: "muted", textContent: "ไม่มีไฟล์แนบ" }),
    ...(canEdit ? [el("button", { type: "button", className: "small secondary", textContent: "+ แนบไฟล์", onclick: () => pick.click() })] : []),
    msg));
  const pick = el("input", { type: "file", multiple: true, onchange: async () => {
    const picked = [...pick.files], failed = [];
    pick.value = "";
    let list = null;
    for (const [i, file] of picked.entries()) {
      msg.textContent = `กำลังอัปโหลด ${i + 1}/${picked.length}: ${file.name}`;
      const form = new FormData();
      form.append("task_id", task.id);
      form.append("file", file);
      try { list = await api("uploadTaskFile", form); } catch (err) { failed.push(`${file.name} — ${err.message}`); }
    }
    msg.textContent = failed.length ? `❌ อัปโหลดไม่สำเร็จ ${failed.length} ไฟล์ (ไฟล์เดิมยังอยู่): ` + failed.join(" · ") : "";
    if (list) draw(list);
  } });
  return {
    box,
    count: () => shown,
    load() {
      if (loaded) return;
      loaded = true;
      box.replaceChildren(el("p", { className: "muted", textContent: "กำลังโหลดไฟล์…" }));
      api("taskFiles", { task_id: task.id }).then(draw, (err) => { loaded = false; box.replaceChildren(el("p", { className: "error", textContent: err.message })); });
    },
  };
}


// ---- Home dashboard (members: own tasks; admins: whole team) ----
// The chart is the ภาพรวมงาน Sankey (sankey(), counts from the server taskFlow); HOME_STATUS only names each task card's badge.
const TAG_LIST = ["ความถูกต้อง", "เสนออนุมัติ/ลงนามกรรมการ", "ติดตามความคืบหน้าคดี", "การประสานงาน"];
const HOME_STATUS = [
  { key: "todo", label: "รอดำเนินการ" },
  { key: "fix", label: "รอแก้ไข" },
  { key: "review", label: "รอตรวจสอบ" },
  { key: "ontime", label: "เสร็จสิ้น · ส่งตรงเวลา" },
  { key: "late", label: "เสร็จสิ้น · ส่งล่าช้า" },
];

/** Status key for Home. "late" = the approved send came after that round's due date. */
function homeStatus(t) {
  if (t.state === "approved") {
    const last = t.sends.filter((s) => s.outcome === "approved").at(-1);
    return last && last.sent_on > t.current_due_on ? "late" : "ontime";
  }
  if (t.state === "submitted") return "review";
  return t.fix_round > 0 ? "fix" : "todo";
}

/** SVG element with attributes (el() makes HTML elements, which SVG can't use). */
function svgEl(tag, attrs = {}, ...kids) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids.filter(Boolean));
  return e;
}

// ภาพรวมงาน Sankey (Home): nodes per column, left to right; the server's taskFlow says which tasks are in each
const FLOW_ROWS = [["new", "carried"], ["doing", "waiting", "approved"], ["ok", "late"]];
const FLOW_NODE = {
  new: { label: "มอบหมายเดือนนี้", color: "#6b7cff" },
  carried: { label: "ค้างจากก่อนหน้า", color: "#9aa3b5" },
  doing: { label: "กำลังทำ / แก้ไข", color: "#ff9f1c" },
  waiting: { label: "รอตรวจ", color: "#fff01f" },
  approved: { label: "อนุมัติเดือนนี้", color: "#39ff14" },
  ok: { label: "ตรงเวลา", color: "#02d7f4" },
  late: { label: "ช้า / เลยกำหนด", color: "#ff4d5e" },
};

/**
 * Left-to-right Sankey of a taskFlow result: where the tasks came from (มอบหมายเดือนนี้ / ค้างจากก่อนหน้า) → their stage
 * now → on time or late. Thin bars, the name and count beside them (left of the first column, right of the last, on a
 * small card over the middle one). A bar's height and a band's width are its number of tasks; bars keep a minimum height
 * so two labels never overlap (the number shown stays exact). Bands take the colour of their outer end: where the task
 * came from on the left, on time / late on the right. pick(key) makes bar + label a button; `selected` outlines one.
 * `width` = the frame's width in px: drawn 1:1 so text stays its normal size; narrower than MIN_W it scales down.
 */
function sankey(f, { pick = null, canPick = () => !!pick, selected = null, width = 0 } = {}) {
  const MIN_W = 396, MIN_H = 30, BAR = 12, PAD = 20, SPLIT = 4; // PAD: room above and below for the edge labels
  const FILL = 0.55; // bars take this share of the height; the rest is open space between them, so the flows branch like roots
  const W = Math.max(MIN_W, Math.round(width)), H = W > 700 ? 340 : 300;
  const LABEL = W > 700 ? 130 : 112; // room for the outer columns' labels
  const colX = [LABEL, (W - BAR) / 2, W - LABEL - BAR];
  const at = {}; // node -> { x, y, h, n, c }
  FLOW_ROWS.forEach((col, c) => {
    const keys = col.filter((k) => f.nodes[k] > 0);
    const avail = (H - 2 * PAD) * FILL;
    let h = keys.map((k) => Math.max(MIN_H, (f.nodes[k] / f.total) * avail));
    const over = h.reduce((a, b) => a + b, 0) - avail, room = h.reduce((a, b) => a + (b - MIN_H), 0);
    if (over > 0 && room > 0) h = h.map((x) => MIN_H + (x - MIN_H) * (1 - over / room)); // the minimums' extra comes from the big ones
    const free = H - 2 * PAD - h.reduce((a, b) => a + b, 0), gap = keys.length > 1 ? free / (keys.length - 1) : 0;
    let y = keys.length > 1 ? PAD : (H - h[0]) / 2; // spread over the height; a lone bar sits in the middle
    keys.forEach((k, i) => { at[k] = { x: colX[c], y, h: h[i], n: f.nodes[k], c }; y += h[i] + gap; });
  });
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "sankey", role: "group", "aria-label": "ภาพรวมงาน" });

  // bands: each end takes its share of the bar it touches, top to bottom so bands don't cross needlessly, with a SPLIT
  // gap between neighbouring bands so they visibly part like roots
  const order = (k) => at[k].y;
  const links = f.links.filter(([a, b, n]) => n > 0 && at[a] && at[b]);
  const port = (side, sortBy) => {
    const used = {}, out = new Map(), count = {};
    for (const l of links) count[l[side]] = (count[l[side]] ?? 0) + 1;
    for (const l of [...links].sort(sortBy)) {
      const k = l[side], p = at[k], h = (l[2] / p.n) * (p.h - SPLIT * (count[k] - 1));
      used[k] = used[k] ?? p.y;
      out.set(l, [used[k], h]);
      used[k] += h + SPLIT;
    }
    return out;
  };
  const from = port(0, (p, q) => order(p[0]) - order(q[0]) || order(p[1]) - order(q[1]));
  const to = port(1, (p, q) => order(p[1]) - order(q[1]) || order(p[0]) - order(q[0]));
  for (const l of links) {
    const [ya, ha] = from.get(l), [yb, hb] = to.get(l);
    const xa = at[l[0]].x + BAR, xb = at[l[1]].x, xm = (xa + xb) / 2;
    svg.append(svgEl("path", {
      class: "band", fill: FLOW_NODE[at[l[0]].c === 0 ? l[0] : l[1]].color,
      d: `M${xa},${ya} C${xm},${ya} ${xm},${yb} ${xb},${yb} L${xb},${yb + hb} C${xm},${yb + hb} ${xm},${ya + ha} ${xa},${ya + ha} Z`,
    }, svgEl("title", {}, `${FLOW_NODE[l[0]].label} → ${FLOW_NODE[l[1]].label}: ${l[2]} งาน`)));
  }

  // bars, then their name and count: outside on the edges, on a card in the middle
  for (const [k, p] of Object.entries(at)) {
    const node = FLOW_NODE[k], mid = p.y + p.h / 2;
    const [tx, anchor] = p.c === 0 ? [p.x - 8, "end"] : p.c === 2 ? [p.x + BAR + 8, "start"] : [p.x + BAR / 2, "middle"];
    const g = svgEl("g", { class: "node" + (k === selected ? " selected" : ""), style: `--k:${node.color}` },
      svgEl("rect", { class: "bar", x: p.x, y: p.y, width: BAR, height: p.h, rx: 2 }));
    if (p.c === 1) {
      const cw = Math.max(64, node.label.length * 7 + 16);
      g.append(svgEl("rect", { class: "tag", x: tx - cw / 2, y: mid - 19, width: cw, height: 38, rx: 6 }));
    }
    g.append(svgEl("text", { x: tx, y: mid - 3, class: "lab", "text-anchor": anchor }, node.label),
      svgEl("text", { x: tx, y: mid + 13, class: "num", "text-anchor": anchor }, String(p.n)));
    if (pick && canPick(k)) {
      g.classList.add("node-btn");
      g.setAttribute("role", "button");
      g.setAttribute("tabindex", "0");
      g.setAttribute("aria-label", `${node.label} ${p.n} งาน: ดูรายการ`);
      if (k === selected) g.setAttribute("aria-pressed", "true");
      g.addEventListener("click", () => pick(k));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(k); } });
    }
    svg.append(g);
  }
  return svg;
}

/** The line under a Sankey: who and what it covers, fix rounds, the longest wait for review. */
const flowNote = (f, team) => [team && `${f.people} คน · ${f.buildings} นิติ`, `${f.total} งาน`, `แก้อยู่ ${f.fixing}`,
  f.nodes.waiting && `รอตรวจนานสุด ${f.longestWait} วัน`].filter(Boolean).join(" · ");

// ?task=N: opened from the LINE bubble's ส่งงาน button. Read on the first render (after liff.init has
// turned liff.state back into ?task=N), then dropped from the URL so later reloads don't jump again.
let linkUsed = false;
let homeKey = null; // the status group being looked at: kept when the list reloads or auto-refreshes
let homeRedraw = null; // redraws the Sankey at the frame's new width (window resized / phone turned)
let resizeTimer = 0;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => homeRedraw?.(), 150); });

/** Home tasks: the whole team for admins, your own for members. */
const homeTasks = (me) => (me.role === "admin" ? api("listTasks", {}) : api("myTasks"));

/** Draws Home from `data` (auto refresh) or a fresh load; returns the tasks it drew. */
async function renderHome(me, data) {
  const today = bkkToday();
  const isAdmin = me.role === "admin";
  const reload = () => renderHome(me);
  // the tasks (with sends, for the cards) and the Sankey's counts; the server scopes both to the member for members
  const [raw, flow] = await Promise.all([data ?? homeTasks(me), api("taskFlow")]);
  const all = raw.filter((t) => t.state !== "cancelled");
  if (isAdmin && $("trackDot")) {
    // red dot on "ติดตามงาน": how many sent tasks wait for review (อนุมัติ / ไม่อนุมัติ)
    const waiting = all.filter((t) => t.state === "submitted").length;
    $("trackDot").hidden = !waiting;
    $("trackDot").textContent = waiting > 99 ? "99+" : waiting;
    $("trackBtn").setAttribute("aria-label", `ติดตามงาน · Tracking: รอตรวจ ${waiting} งาน`);
  }

  $("dashTitle").textContent = `${isAdmin ? "ภาพรวมงานทีม" : "ภาพรวมงานของฉัน"} · ${new Date(today + "T00:00:00+07:00").toLocaleDateString("th-TH", { month: "long", year: "numeric" })}`;
  const byId = new Map(all.map((t) => [t.id, t]));
  const tasksOf = (k) => (flow.ids[k] ?? []).map((id) => byId.get(id)).filter(Boolean);
  const statusText = Object.fromEntries(HOME_STATUS.map((s) => [s.key, s.label]));
  const pick = (k) => {
    homeKey = k;
    const tasks = tasksOf(k).sort((a, b) => a.current_due_on.localeCompare(b.current_due_on));
    draw(k);
    $("dashListTitle").textContent = `${FLOW_NODE[k].label} (${tasks.length})`;
    $("dashList").replaceChildren(...(tasks.length
      ? tasks.map((t) => taskItem(t, today, reload, { admin: isAdmin, status: statusText[homeStatus(t)] }))
      : [el("p", { className: "muted", textContent: "ไม่มีงาน" })]));
  };
  // every bar opens its tasks below; the tapped one is outlined
  const draw = (selected) => $("dashChart").replaceChildren(...(flow.total
    ? [sankey(flow, { pick, selected, width: $("dashChart").clientWidth }), el("p", { className: "muted small-note flow-sub", textContent: flowNote(flow, isAdmin) })]
    : [el("p", { className: "muted", textContent: "ยังไม่มีงานที่เปิดอยู่หรืออนุมัติในเดือนนี้" })]));

  homeRedraw = () => draw(homeKey);

  // Open the list people most likely need: work to do, then waiting review, then the rest
  const has = (k) => flow.nodes[k] > 0;
  pick(homeKey && has(homeKey) ? homeKey : ["doing", "waiting", "approved", "new", "carried"].find(has) ?? "doing");

  const linkedId = !linkUsed && Number(new URLSearchParams(location.search).get("task"));
  linkUsed = true;
  if (linkedId) history.replaceState(null, "", location.pathname);
  const stage = linkedId && ["doing", "waiting", "approved"].find((k) => (flow.ids[k] ?? []).includes(linkedId));
  if (stage) {
    pick(stage);
    const item = $("dashList").querySelector(`[data-task="${linkedId}"]`);
    item.open = true;
    item.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return raw;
}

// ---- Ex Doc groups (Button C and admin/exdoc.html) ----
const NO_GROUP = "อื่นๆ · ไม่มีกลุ่ม";
/** [{ id, name, docs }] in group order (A-Z), documents without a group last. Empty groups only when keepEmpty. */
function groupDocs(groups, docs, keepEmpty = false) {
  const known = new Set(groups.map((g) => g.id));
  const sections = [...groups, { id: null, name: NO_GROUP }].map((g) => ({
    ...g, docs: docs.filter((d) => (g.id === null ? !known.has(d.group_id) : d.group_id === g.id)),
  }));
  return sections.filter((s) => s.docs.length || (keepEmpty && s.id !== null));
}

// ---- Home: ข่าวสาร · News (everyone reads; admins add, pin, delete) ----
const NEWS_PAGE = 7; // per page, pinned included (pinned come first, so page 1 starts with them)
async function initNews(me) {
  const admin = me.role === "admin";
  let items = [], page = 0;
  const render = () => {
    const pages = Math.max(1, Math.ceil(items.length / NEWS_PAGE));
    page = Math.min(page, pages - 1); // a delete can remove the last page
    const rows = items.slice(page * NEWS_PAGE, (page + 1) * NEWS_PAGE);
    $("newsList").replaceChildren(...(rows.length ? rows.map((n) => {
      const actions = admin && el("div", { className: "news-actions" },
        el("button", { type: "button", className: "small secondary", textContent: n.pinned ? "เลิกปักหมุด" : "📌 ปักหมุด", onclick: () => act("pinNews", { id: n.id, pinned: !n.pinned }) }),
        el("button", { type: "button", className: "small danger", textContent: "ลบ", onclick: () => confirm(`ลบข่าว "${n.title}"?`) && act("deleteNews", { id: n.id }) }));
      const dot = !n.read && el("span", { className: "news-dot", title: "ยังไม่ได้อ่าน · Unread", ariaLabel: "ยังไม่ได้อ่าน" });
      // collapsed: title only; tap to read (first open marks it read)
      const item = el("details", { className: "news-item" + (n.pinned ? " pinned" : "") },
        el("summary", { className: "news-head" },
          n.pinned && el("span", { className: "news-pin", textContent: "📌", title: "ปักหมุด · Pinned" }),
          el("strong", { className: "grow", textContent: n.title }), dot,
          el("span", { className: "muted news-date", textContent: thDate(n.created_at.slice(0, 10)) })),
        n.body && el("p", { className: "pre news-body", textContent: n.body }),
        actions);
      item.dataset.key = "news" + n.id; // stays open through an auto refresh
      item.addEventListener("toggle", () => {
        if (!item.open || n.read) return;
        n.read = true;
        dot?.remove();
        api("readNews", { id: n.id }).catch(() => { n.read = false; }); // not saved: the dot comes back on the next load
      });
      return item;
    }) : [el("p", { className: "muted", textContent: "ยังไม่มีข่าว" })]));
    $("newsPager").hidden = pages < 2;
    $("newsPage").textContent = `${page + 1} / ${pages}`;
    $("newsPrev").disabled = page === 0;
    $("newsNext").disabled = page >= pages - 1;
  };
  async function act(action, data) {
    try { items = await api(action, data); render(); } catch (err) { alert(err.message); }
  }
  $("newsPrev").onclick = () => { page--; render(); };
  $("newsNext").onclick = () => { page++; render(); };
  if (admin) {
    $("newsAddBtn").hidden = false;
    $("newsAddBtn").onclick = () => { $("newsForm").hidden = !$("newsForm").hidden; $("newsTitle").focus(); };
    $("newsCancel").onclick = () => { $("newsForm").hidden = true; };
    $("newsForm").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, btn = e.submitter;
      btn.disabled = true;
      try {
        const v = f.elements; // via .elements: fields named "title" would shadow form.title
        items = await api("addNews", { title: v.title.value, body: v.body.value, pinned: v.pinned.checked });
        f.reset();
        f.hidden = true;
        $("newsMsg").textContent = "";
        render();
      } catch (err) { $("newsMsg").textContent = err.message; }
      btn.disabled = false;
    };
  }
  items = await api("listNews");
  render();
  autoRefresh({ box: $("newsList").closest(".card"), load: () => api("listNews"), draw: (fresh) => { items = fresh; render(); } }).seen(items);
}

/** Inside one group: documents with no subfolder first, then one open section per subfolder (A-Z). */
function docsBySubgroup(docs, rowFn) {
  const subs = [...new Set(docs.map((d) => d.subgroup).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  return [
    ...docs.filter((d) => !d.subgroup).map(rowFn),
    ...subs.map((sg) => {
      const inside = docs.filter((d) => d.subgroup === sg);
      return el("details", { className: "doc-sub", open: true },
        el("summary", {}, "📁 ", el("span", { textContent: sg }), el("span", { className: "badge", textContent: inside.length })),
        ...inside.map(rowFn));
    }),
  ];
}
const fileType = (name) => (/\.docx?$/i.test(name) ? "Word" : /\.(jpe?g|png)$/i.test(name) ? "รูป" : /\.(zip|rar)$/i.test(name) ? "ไฟล์บีบอัด" : "PDF");
