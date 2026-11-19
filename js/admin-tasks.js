// Task screens: assign form (Home, admins), tracking page (admin/tasks.html), performance table (Reports).
// Needs js/app.js and js/work.js (el, thDate, bkkToday, OUTCOME_TEXT, TAG_LIST).
const STATE_TEXT = { on_process: "กำลังดำเนินการ", submitted: "รอตรวจ", approved: "อนุมัติ", cancelled: "ยกเลิก" };
let buildings = [], members = [];

const option = (value, text) => el("option", { value, textContent: text });
const check = (name, value, text) => el("label", { className: "inline" }, el("input", { type: "checkbox", name, value }), " " + text);
const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

/** รอตรวจ: open the member's files for this task, i.e. the task's own Drive folder (made by their first upload). */
function taskFolderButton(t) {
  const msg = el("span", { className: "muted small-note", role: "status" });
  const btn = el("button", { type: "button", className: "small secondary", textContent: "📂 เปิดโฟลเดอร์งาน (Google Drive)" });
  btn.onclick = async () => {
    // computer: open the tab before the wait (pop-up blocker); LINE app: open Drive in the phone's browser after
    const win = !liff.isInClient() ? window.open("about:blank", "_blank") : null;
    btn.disabled = true;
    msg.textContent = " กำลังเปิด…";
    try {
      const { url, files } = await api("taskFiles", { task_id: t.id });
      if (!url) { win?.close(); msg.textContent = " ไม่มีไฟล์แนบ"; }
      else { if (win) win.location = url; else openFile(url, true); msg.textContent = ` ${files.length} ไฟล์`; }
    } catch (err) { win?.close(); msg.textContent = " ❌ " + err.message; }
    btn.disabled = false;
  };
  return el("p", {}, btn, msg);
}

/** Read-only task summary shared by the review queue and the all-tasks list. */
function adminTaskBody(t) {
  const files = t.files.map((f) => f.url
    ? el("li", {}, el("a", { href: f.url, target: "_blank", textContent: f.name }),
      ...(f.drive_url && f.drive_url !== f.url ? [" · ", el("a", { href: f.drive_url, target: "_blank", textContent: "📂 Drive" })] : []))
    : el("li", { className: "muted", textContent: f.name + " (ลบแล้ว)" }));
  return el("div", { className: "task-body" },
    el("p", { className: "muted", textContent: `${t.owner_name} · ${STATE_TEXT[t.state]} · เดิม ${thDate(t.due_on)} · ปัจจุบัน ${thDate(t.current_due_on)}` }),
    t.details && el("p", { className: "pre", textContent: t.details }),
    el("p", {}, ...t.tags.map((x) => el("span", { className: "tag", textContent: x }))),
    taskFolderButton(t), // every task, so old (history) tasks' sent files can be opened too
    t.sends.length > 0 && el("ol", { className: "timeline" }, ...t.sends.map((s) => el("li", {},
      `ส่ง ${thDate(s.sent_on)} (กำหนด ${thDate(s.due_on)})${deliveryNote(s)} → ${OUTCOME_TEXT[s.outcome]}`,
      s.fix_note ? el("div", { className: "muted pre", textContent: s.fix_note }) : null))),
    files.length > 0 && el("ul", {}, ...files),
  );
}

/** Right side of a task row (this page is admins only): was the new-task LINE card sent, and 📨 to send it again. */
function notifyStatus(t) {
  const sent = !!t.member_notified_at;
  const box = el("span", { className: "notify " + (sent ? "muted" : "error"),
    textContent: sent ? `🔔 แจ้งแล้ว ${thDate(bkkDay(t.member_notified_at))}` : "🔕 ยังไม่แจ้ง" });
  if (t.state !== "on_process") return box; // the card has a ส่งงาน button: only useful while the task is open
  const btn = el("button", { type: "button", className: "icon-btn", textContent: "📨", title: "ส่งแจ้งเตือนงานนี้ทาง LINE อีกครั้ง", ariaLabel: "ส่งแจ้งเตือนอีกครั้ง" });
  btn.onclick = async (e) => {
    e.preventDefault(); // inside <summary>: don't open / close the task
    if (btn.disabled || !confirm(`ส่งแจ้งเตือน "${t.title}" ถึง ${t.owner_name} ทาง LINE อีกครั้ง?`)) return;
    btn.disabled = true; // one push per tap
    try { await api("resendNotice", { task_id: t.id }); loadAll(); }
    catch (err) { alert(err.message); btn.disabled = false; }
  };
  box.append(btn);
  return box;
}

function summaryLine(t) {
  const overdue = t.state === "on_process" && t.current_due_on < bkkToday();
  return el("summary", {},
    notifyStatus(t),
    el("strong", { textContent: t.title }),
    el("span", { className: "muted", textContent: ` · ${t.building} · ${t.owner_name} · ${thDate(t.current_due_on)}` }),
    overdue && el("span", { className: "badge late", textContent: "เลยกำหนด" }),
    t.fix_round > 0 && el("span", { className: "badge", textContent: `รอบแก้ ${t.fix_round}` }),
    t.fix_round > 5 && el("span", { className: "badge late", textContent: "เกิน 5 รอบแก้ไข" }));
}

// lock every button in box while one request runs, so a double tap can't send twice;
// success re-renders the list (fresh buttons), so only an error unlocks them
async function locked(box, fn) {
  const btns = [...box.querySelectorAll("button")];
  if (btns.some((b) => b.disabled)) return;
  btns.forEach((b) => { b.disabled = true; });
  try { await fn(); } catch (err) { btns.forEach((b) => { b.disabled = false; }); throw err; }
}

/**
 * A file input whose picks add up: on phones (LINE's picker) a pick often gives one file, and a new pick would replace
 * the last one. Each pick joins a list under the input, with ✕ to take one out. files() -> the list; clear() empties it.
 */
function filePile(input) {
  let list = [];
  const box = el("div", { className: "task-files" });
  const draw = () => box.replaceChildren(...list.map((f, i) => el("div", { className: "inv-file" },
    el("span", { className: "inv-file-name", textContent: (f.type === "application/pdf" ? "📄 " : "🖼️ ") + f.name }),
    el("button", { type: "button", className: "icon-btn", textContent: "✕", title: "เอาออก", ariaLabel: "เอาออก " + f.name,
      onclick: () => { list.splice(i, 1); draw(); } }))));
  input.addEventListener("change", () => {
    const same = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified; // picked twice
    list.push(...[...input.files].filter((f) => !list.some((x) => same(x, f))));
    input.value = ""; // so the next pick adds, and picking the same file again still fires
    draw();
  });
  input.after(box, el("p", { className: "muted small-note", textContent: "เลือกได้หลายไฟล์ · กดเลือกอีกครั้งเพื่อเพิ่มไฟล์" }));
  return { files: () => [...list], clear: () => { list = []; draw(); } };
}

function reviewControls(t) {
  const msg = el("p", { role: "alert", className: "error" });
  const reason = el("select", { required: true }, option("", "เลือกเหตุผล"), option("กดผิด", "กดผิด"), option("มีปรับแก้", "มีปรับแก้"));
  const note = el("textarea", { rows: 3, maxLength: 2000, placeholder: "ระบุส่วนที่ต้องแก้ไข" });
  const due = el("input", { type: "date", min: bkkToday() });
  // files for the fix (PDF / pictures): the member can view and print them on the task
  const files = el("input", { type: "file", multiple: true, accept: "application/pdf,image/jpeg,image/png,image/webp" });
  const fixBox = el("div", { hidden: true }, el("label", { textContent: "สิ่งที่ต้องแก้ไข" }), note, el("label", { textContent: "กำหนดส่งแก้" }), due,
    el("label", { textContent: "แนบไฟล์ให้ผู้รับงาน (PDF / รูป, ไม่เกิน 10 MB ต่อไฟล์)" }), files);
  const pile = filePile(files);
  const notForm = el("form", { hidden: true }, el("label", { textContent: "เหตุผล" }), reason, fixBox, el("button", { textContent: "ยืนยันไม่อนุมัติ" }));
  reason.onchange = () => {
    const fix = reason.value === "มีปรับแก้";
    fixBox.hidden = !fix;
    note.required = due.required = fix;
  };
  const submit = async (payload, attach = []) => {
    msg.textContent = "";
    try {
      await locked(box, async () => {
        await api("reviewTask", { task_id: t.id, ...payload });
        // sent back: now attach the files; the review is already saved, so a failed file is only reported
        const failed = attach.length ? await uploadBriefFiles([t.id], attach, (x) => { msg.textContent = x; }) : [];
        if (failed.length) alert("ส่งกลับแก้ไขแล้ว แต่แนบไฟล์ไม่สำเร็จ: " + failed.join(" · "));
      });
    } catch (err) {
      if (/already reviewed/.test(err.message)) alert("งานนี้ถูกตรวจโดยแอดมินคนอื่นแล้ว (already reviewed by another admin)");
      else return void (msg.textContent = err.message);
    }
    loadAll();
  };
  notForm.onsubmit = (e) => {
    e.preventDefault();
    submit({ decision: reason.value, note: note.value, next_due_on: due.value }, reason.value === "มีปรับแก้" ? pile.files() : []);
  };
  const approve = el("button", { type: "button", className: "small", textContent: "อนุมัติ (Approved)" });
  approve.onclick = () => submit({ decision: "approved" });
  const reject = el("button", { type: "button", className: "small danger", textContent: "ไม่อนุมัติ (Not approved)" });
  reject.onclick = () => { notForm.hidden = false; };
  const box = el("div", {}, approve, reject, notForm, msg);
  return box;
}

function editControls(t) {
  if (t.sends.length || t.state !== "on_process") return null;
  const title = el("input", { value: t.title, maxLength: 200, required: true });
  const due = el("input", { type: "date", value: t.current_due_on, min: bkkToday(), required: true });
  const form = el("form", { hidden: true }, el("label", { textContent: "หัวข้อ" }), title, el("label", { textContent: "กำหนดส่ง" }), due,
    el("button", { textContent: "บันทึก" }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await locked(box, () => api("editTask", { task_id: t.id, title: title.value, due_on: due.value })); loadAll(); }
    catch (err) { alert(err.message); }
  };
  const edit = el("button", { type: "button", className: "small secondary", textContent: "แก้ไข" });
  edit.onclick = () => { form.hidden = !form.hidden; };
  const cancel = el("button", { type: "button", className: "small danger", textContent: "ยกเลิกงาน" });
  cancel.onclick = async () => {
    if (!confirm(`ยกเลิกงาน "${t.title}"?`)) return;
    try { await locked(box, () => api("cancelTask", { task_id: t.id })); loadAll(); } catch (err) { alert(err.message); }
  };
  const box = el("div", {}, edit, cancel, form);
  return box;
}

/** A task card; data-key keeps it open / closed through an auto refresh. */
const taskCard = (t, open, ...kids) => { const d = el("details", { className: "task", open }, ...kids); d.dataset.key = "t" + t.id; return d; };

// both lists refresh by themselves (every minute and when you come back; see autoRefresh in js/app.js)
let reviewWatch = null, listWatch = null;
const reviewData = async () => (await api("listTasks", { state: "submitted" }))
  .sort((a, b) => (a.sends.at(-1)?.sent_at ?? "").localeCompare(b.sends.at(-1)?.sent_at ?? ""));
function drawReview(list) {
  $("reviewCount").textContent = list.length;
  $("reviewList").replaceChildren(...(list.length
    ? list.map((t) => taskCard(t, false, summaryLine(t), adminTaskBody(t), reviewControls(t))) // closed: name line only, tap to review
    : [el("p", { className: "muted", textContent: "ไม่มีงานรอตรวจ" })]));
}
async function loadReview() {
  const list = await reviewData();
  drawReview(list);
  reviewWatch?.seen(list);
}

const listData = () => api("listTasks", {
  owner: $("fOwner").value || undefined,
  building: $("fBuilding").value || undefined,
  state: $("fState").value || undefined,
  overdue: $("fOverdue").checked || undefined,
});
function drawList(list) {
  allTasks = list.sort((a, b) => b.id - a.id); // newest first, so page 1 is the latest work and old tasks are further back
  renderAll(); // keeps the page after an edit / cancel / refresh (renderAll clamps it)
}
async function loadList() {
  const list = await listData();
  drawList(list);
  listWatch?.seen(list);
}

// All tasks: 20 per page, after the 🔍 search (text match on what the filters loaded)
const ALL_PAGE = 20;
let allTasks = [], allPage = 0;
const taskText = (t) => [`#${t.id}`, t.id, t.title, t.details, t.owner_name, t.building, ...t.tags, STATE_TEXT[t.state],
  ...t.sends.map((s) => s.fix_note), ...t.files.map((f) => f.name)].filter(Boolean).join(" ").toLowerCase();
function renderAll() {
  const q = $("fQ").value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean); // every word must match, in any field
  const shown = words.length ? allTasks.filter((t) => { const s = taskText(t); return words.every((w) => s.includes(w)); }) : allTasks;
  const pages = Math.max(1, Math.ceil(shown.length / ALL_PAGE));
  allPage = Math.min(allPage, pages - 1);
  $("allCount").textContent = shown.length;
  $("allList").replaceChildren(...(shown.length
    ? shown.slice(allPage * ALL_PAGE, (allPage + 1) * ALL_PAGE).map((t) => taskCard(t, false, summaryLine(t), adminTaskBody(t), editControls(t)))
    : [el("p", { className: "muted", textContent: "ไม่พบงาน" })]));
  $("allPager").hidden = pages < 2;
  $("allPage").textContent = `${allPage + 1} / ${pages}`;
  $("allPrev").disabled = allPage === 0;
  $("allNext").disabled = allPage >= pages - 1;
}

// performance columns: emoji + one short word (fits phones); tap for the full name and how it is scored
const PERF_COLS = {
  assigned: ["📥", "มอบหมาย", "งานที่มอบหมาย", "งานที่อยู่ในความรับผิดชอบช่วงนี้: นับตามเดือนของกำหนดส่งครั้งแรก (เช่น มอบหมาย 1/1 กำหนดส่ง 2/2 = งานของเดือน 2) รวมงานที่ค้างมาจากช่วงก่อนและยังไม่อนุมัติ และงานที่อนุมัติในช่วงนี้ (ไม่รวมงานที่ถูกยกเลิก) · จึงไม่น้อยกว่าจำนวนอนุมัติ"],
  tasks: ["🗂️", "อนุมัติ", "งานที่อนุมัติแล้ว", "จำนวนงานที่แอดมินอนุมัติในเดือนหรือไตรมาสนี้"],
  overall: ["⭐", "รวม", "คะแนนรวม", "ค่าเฉลี่ยของคะแนน 1–5 ของคนนั้น: คะแนนตรงเวลา และทุกหมวดที่มีงาน (ไม่รวมหมวดที่เป็น \"-\") · ตัวเลขเล็ก = ค่าเฉลี่ยของ %"],
  onTime: ["⏰", "ตรงเวลา", "คะแนนตรงเวลา", "กดส่งภายในวันที่กำหนด (งานที่ไม่ได้กดส่งตามกำหนดเวลาจะถูกคำนวณเป็นงานล่าช้า)"],
  "ความถูกต้อง": ["✅", "ถูกต้อง", "คะแนนความถูกต้อง", "เตรียมเอกสารประกอบครบ เช่น หนังสือแจ้งเตือน, รายการยอดค้าง · คิดจากจำนวนครั้งที่ถูกส่งกลับแก้ไข: ไม่มีแก้ไข = เต็ม 10, หัก 2 คะแนนต่อรอบ (มีปรับแก้) · ส่งช้าไม่หักในหมวดนี้"],
  "เสนออนุมัติ/ลงนามกรรมการ": ["⚡", "รวดเร็ว", "คะแนนเสนออนุมัติ/ลงนามกรรมการ", "นำข้อมูลเข้าเสนอกรรมการได้เร็ว และสรุปมติเป็นขั้นตอน · คิดจากทุกครั้งที่ส่ง: ส่งก่อนหรือตรงกำหนด = 10, ช้า = 10 − (วันที่ช้า ÷ 3) ไม่ต่ำกว่า 0 แล้วเฉลี่ย · นับเฉพาะงานที่ติดหมวดนี้"],
  "ติดตามความคืบหน้าคดี": ["🔎", "ติดตาม", "คะแนนติดตามความคืบหน้าคดี", "ติดตามคดีอย่างต่อเนื่อง มีการอัปเดตสถานะ · คิดจากทุกครั้งที่ส่ง: ส่งก่อนหรือตรงกำหนด = 10, ช้า = 10 − (วันที่ช้า ÷ 3) ไม่ต่ำกว่า 0 แล้วเฉลี่ย · นับเฉพาะงานที่ติดหมวดนี้"],
  "การประสานงาน": ["🤝", "ประสานงาน", "คะแนนการประสานงาน", "ตอบสนองไว ประสานงานเป็นระบบ · คิดจากทุกครั้งที่ส่ง: ส่งก่อนหรือตรงกำหนด = 10, ช้า = 10 − (วันที่ช้า ÷ 3) ไม่ต่ำกว่า 0 แล้วเฉลี่ย · นับเฉพาะงานที่ติดหมวดนี้"],
};

function perfHead(key) {
  const [emoji, short, full, how] = PERF_COLS[key];
  const b = el("button", { type: "button", className: "perf-col", title: `${full}: ${how}`, ariaLabel: full },
    el("span", { className: "perf-emoji", textContent: emoji, ariaHidden: "true" }), el("span", { className: "perf-short", textContent: short }),
    el("span", { className: "perf-full", textContent: full })); // printed instead of the emoji + short word
  b.onclick = () => {
    const info = $("perfInfo"), same = !info.hidden && info.dataset.key === key;
    info.hidden = same;
    info.dataset.key = key;
    info.replaceChildren(el("strong", { textContent: `${emoji} ${full}` }), " · " + how);
  };
  return el("th", {}, b);
}

// tap a name: the tasks behind that person's scores in the chosen period, one row each
const STATUS_TEXT = (t) => (t.state === "approved" ? "✅ เสร็จแล้ว" : t.state === "submitted" ? "⏳ รอตรวจ"
  : t.state === "cancelled" ? "ยกเลิก" : t.fix_round > 0 ? "↩️ ส่งกลับแก้ไข" : "ยังไม่ส่ง");

function perfName(r, res) {
  const b = el("button", { type: "button", className: "perf-name", textContent: r.name, title: "ดูงานในช่วงนี้" });
  b.setAttribute("aria-expanded", "false");
  b.onclick = () => {
    const box = $("perfDetail"), same = !box.hidden && box.dataset.who === r.line_user_id;
    document.querySelectorAll(".perf-name").forEach((x) => x.setAttribute("aria-expanded", "false"));
    box.hidden = same;
    box.dataset.who = r.line_user_id;
    if (same) return;
    b.setAttribute("aria-expanded", "true");
    showPerfDetail(r, res);
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  return b;
}

function showPerfDetail(r, res) {
  const head = el("tr", {}, ...["งาน", "สถานะ", "กำหนดส่งเดิม", "กำหนดส่งล่าสุด", "วันส่งงานล่าสุด", "แก้ไข (ครั้ง)", "เกินกำหนด (วัน)"]
    .map((h) => el("th", { textContent: h })));
  // every task in มอบหมาย: อนุมัติ first, then late ones (คะแนนตรงเวลา only), then not scored yet
  const ORDER = { approved: 0, late: 1, none: 2 }, NOTE = { approved: "", late: " · นับเฉพาะตรงเวลา", none: " · ยังไม่นับคะแนน" };
  const items = [...r.items].sort((a, b) => ORDER[a.counts] - ORDER[b.counts] || a.current_due_on.localeCompare(b.current_due_on));
  const count = (k) => items.filter((t) => t.counts === k).length;
  const rows = items.map((t) => el("tr", { className: t.counts === "approved" ? "" : "late-only" },
    el("td", {}, el("strong", { textContent: t.title }), el("div", { className: "muted", textContent: t.building })),
    el("td", { className: "nowrap", textContent: STATUS_TEXT(t) + NOTE[t.counts] }),
    el("td", { className: "nowrap", textContent: thDate(t.due_on) }),
    el("td", { className: "nowrap", textContent: thDate(t.current_due_on) }),
    el("td", { className: "nowrap", textContent: t.last_sent_on ? thDate(t.last_sent_on) : "-" }),
    el("td", { textContent: t.fixes }),
    el("td", { className: t.daysLate ? "error" : "", textContent: t.daysLate })));
  const close = el("button", { type: "button", className: "small secondary no-print", textContent: "ปิด" });
  close.onclick = () => { $("perfDetail").hidden = true; };
  $("perfDetail").replaceChildren(
    el("div", { className: "row card-head" },
      el("h3", { className: "grow", textContent: `งานในช่วงนี้ · ${r.name} (${thDate(res.from)} – ${thDate(res.to)})` }), close),
    // same numbers as the table row: มอบหมาย = every row here, อนุมัติ = the approved ones
    el("p", { className: "muted small-note", textContent: `มอบหมาย ${items.length} งาน · อนุมัติ ${count("approved")} · นับเฉพาะตรงเวลา ${count("late")} · ยังไม่นับคะแนน ${count("none")}` }),
    el("div", { className: "table-wrap" }, el("table", { className: "perf-detail-table" }, head,
      ...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 7, className: "muted", textContent: "ไม่มีงานในช่วงนี้" }))]))),
    el("p", { className: "muted small-note", textContent: "อนุมัติ = นับทุกคะแนน · นับเฉพาะตรงเวลา = ยังไม่อนุมัติแต่เลยกำหนด นับแค่คะแนนตรงเวลา · ยังไม่นับคะแนน = ยังไม่ถึงกำหนดหรือรอตรวจ จะนับเมื่ออนุมัติ หรือเมื่อเลยกำหนด" }));
}

const perfData = () => api("performance", { kind: $("pKind").value, year: Number($("pYear").value), n: Number($("pN").value) });
/** Draws the table from `res` (auto refresh) or loads the picked period. */
async function loadPerformance(res) {
  if (!res) {
    $("perfDetail").hidden = true; // a new period: the open list would be stale
    res = await perfData();
  }
  const pct = (x) => (x * 100).toFixed(1) + "%"; // raw score: average task score / 10
  // one cell = the 1–5 score (big) over the raw % (small); how both are made is explained under the table
  const score = (scaled, raw) => scaled === null ? el("td", { className: "muted", textContent: "-" }) : el("td", { className: "perf-score" },
    el("strong", { textContent: scaled.toFixed(2) }), el("span", { className: "muted", textContent: pct(raw) }));
  const rank = navAdmin; // members only get their own row, so a rank would always read 1
  const head = el("tr", {}, ...[...(rank ? ["#"] : []), "ชื่อ"].map((h) => el("th", { textContent: h })),
    ...["assigned", "tasks", "overall", "onTime", ...TAG_LIST].map(perfHead));
  // scored people by คะแนนรวม, then people with assigned work but no score yet (no rank)
  const rows = res.rows.sort((a, b) => (b.overall5 ?? -1) - (a.overall5 ?? -1) || a.name.localeCompare(b.name, "th")).map((r, i) => el("tr", {},
    rank && el("td", { className: "muted", textContent: r.overall5 === null ? "-" : i + 1 }), el("td", {}, perfName(r, res)), el("td", { textContent: r.assigned }), el("td", { textContent: r.tasks }),
    score(r.overall5, r.overall), score(r.onTime5, r.onTime),
    ...TAG_LIST.map((tag) => (r.byTag[tag] ? score(r.byTag[tag].scaled, r.byTag[tag].raw) : el("td", { className: "muted", textContent: "-" })))));
  $("perfTable").replaceChildren(el("caption", { className: "muted", textContent: `${thDate(res.from)} – ${thDate(res.to)}` }), head,
    ...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: (rank ? 6 : 5) + TAG_LIST.length, textContent: "ยังไม่มีงานที่นับคะแนนในช่วงนี้" }))]));
}

async function loadWarnings() {
  const bad = await api("sheetWarnings");
  $("warnCard").hidden = !bad.length;
  $("warnList").replaceChildren(...bad.map((b) => el("li", { textContent: `Sheet "${b.tab}" row ${b.row}: ${b.reason}` })));
}

function loadAll() {
  loadWarnings().catch(() => {}); // the lists below show the error if the sheet is down
  loadReview().catch((e) => { $("reviewList").textContent = "Error: " + e.message; });
  loadList().catch((e) => { $("allList").textContent = "Error: " + e.message; });
}

async function loadBuildings(selectName) {
  buildings = await api("listBuildings");
  if ($("fBuilding")) $("fBuilding").replaceChildren(option("", "นิติบุคคล: ไม่กรอง · Any building"), ...oneAllBuilding(buildings).map((b) => option(b.name, b.name)));
  if ($("building")) filterBuildings(selectName ? [selectName] : undefined);
}

const memberLabel = (m) => (m.staff_name || m.display_name || m.line_user_id).trim();
const isAllBuilding = (b) => b.name.trim().startsWith("ทุกนิติ"); // "ทุกนิติ" = every building (as in responsibility.ts)
/** "ทุกนิติ" and "ทุกนิติบุคคล" mean the same: keep one (the first) so pickers show it once. */
const oneAllBuilding = (list) => { let seen = false; return list.filter((b) => !isAllBuilding(b) || (!seen && (seen = true))); };

/**
 * Assign form: show only the buildings the chosen หัวหน้างาน look after (ข้อมูลการมอบหมาย), as a multi-select.
 * Same rule as the server (responsibility.ts): someone with no buildings yet is not restricted.
 */
function filterBuildings(keep = checked("bld")) {
  const chosen = checked("owner").map((id) => memberLabel(members.find((m) => m.line_user_id === id) ?? { line_user_id: id }));
  const restricted = chosen.filter((n) => buildings.some((b) => b.owner === n));
  const shown = oneAllBuilding(restricted.length ? buildings.filter((b) => isAllBuilding(b) || restricted.every((n) => b.owner === n)) : buildings);
  const own = shown.filter((b) => !isAllBuilding(b)).length;
  $("building").replaceChildren(...(shown.length ? shown.map((b) => {
    const box = check("bld", b.name, b.name);
    box.querySelector("input").checked = keep.includes(b.name); // ticks survive a change of person when still allowed
    return box;
  }) : [el("p", { className: "muted", textContent: "— ไม่มีนิติบุคคลที่ดูแลร่วมกัน —" })]));
  $("buildingSearch").value = "";
  $("buildingHint").dataset.base = !chosen.length ? "เลือกผู้รับงานก่อน เพื่อแสดงเฉพาะนิติบุคคลที่ดูแล"
    : !restricted.length ? "ผู้รับงานที่เลือกยังไม่มีนิติบุคคลในข้อมูลการมอบหมาย · แสดงทั้งหมด"
    : own ? `แสดงเฉพาะนิติบุคคลที่ ${restricted.join(", ")} ดูแล (${own}) และ "ทุกนิติ"`
    : "ผู้รับงานที่เลือกไม่มีนิติบุคคลที่ดูแลร่วมกัน · มอบหมายทีละคน";
  showPicked();
}

/** Button text = what is ticked; hint adds how many task rows will be created (person × building). */
function showPicked() {
  const picked = checked("bld"), owners = checked("owner").length;
  $("buildingBtn").textContent = !picked.length ? "เลือกนิติบุคคล" : picked.length === 1 ? picked[0]
    : `${picked.length} นิติบุคคล: ${picked.slice(0, 3).join(", ")}${picked.length > 3 ? " …" : ""}`;
  const rows = owners * picked.length;
  $("buildingHint").textContent = $("buildingHint").dataset.base + (rows ? ` · จะสร้าง ${rows} งาน (${owners} คน × ${picked.length} นิติบุคคล)` : "");
}

/** The building dropdown: open/close, search, select all / none. */
function initBuildingPicker() {
  const pop = $("buildingPop"), btn = $("buildingBtn");
  const open = (on) => { pop.hidden = !on; btn.setAttribute("aria-expanded", String(on)); if (on) $("buildingSearch").focus(); };
  btn.onclick = () => open(pop.hidden);
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !e.target.closest("#buildingPick")) open(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { open(false); btn.focus(); } });
  $("buildingSearch").oninput = () => {
    const q = $("buildingSearch").value.trim().toLowerCase();
    $("building").querySelectorAll("label").forEach((l) => { l.hidden = !!q && !l.textContent.toLowerCase().includes(q); });
  };
  const setAll = (on) => { $("building").querySelectorAll("label:not([hidden]) input").forEach((i) => { i.checked = on; }); showPicked(); };
  $("buildingAll").onclick = () => setAll(true);   // only the ones the search shows
  $("buildingNone").onclick = () => setAll(false);
  $("building").addEventListener("change", showPicked);
}

/** Home (admins): the assign form, shown by the "มอบหมายงาน" button. onCreated refreshes the dashboard. */
async function initAssignForm(onCreated) {
  $("dueOn").min = bkkToday();
  $("tags").replaceChildren(...TAG_LIST.map((t) => check("tag", t, t)));
  members = await api("listMembers");
  $("owners").replaceChildren(...(members.length
    ? members.map((m) => check("owner", m.line_user_id, m.staff_name || m.display_name || m.line_user_id))
    : [el("p", { className: "muted", textContent: "ยังไม่มีสมาชิก (members)" })]));
  initBuildingPicker();
  await loadBuildings();
  $("owners").addEventListener("change", () => filterBuildings());

  let saving = false; // one save at a time: a double tap / second click while saving does nothing
  const assignPile = filePile($("assignFiles"));
  $("createForm").onsubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const tags = checked("tag"), owners = checked("owner");
    const picked = checked("bld");
    // หมวดหมู่ is optional: a task with none counts in คะแนนตรงเวลา only
    if (!owners.length || !picked.length) return void ($("createMsg").textContent = "เลือกผู้รับงาน และนิติบุคคล อย่างน้อยอย่างละ 1");
    const btn = e.submitter ?? $("createForm").querySelector("button:not([type=button])");
    const label = btn.textContent;
    saving = true;
    btn.disabled = true;
    btn.textContent = "กำลังมอบหมาย…";
    try {
      const made = await api("createTask", {
        buildings: picked, title: $("title").value, details: $("details").value,
        tags, owners, due_on: $("dueOn").value,
      });
      const files = assignPile.files();
      const failed = files.length ? await uploadBriefFiles(made.map((t) => t.id), files, (t) => { $("createMsg").textContent = t; }) : [];
      $("createMsg").textContent = `มอบหมายแล้ว ${made.length} งาน` + (failed.length ? ` · ❌ แนบไฟล์ไม่สำเร็จ: ${failed.join(" · ")} (แนบใหม่ได้ตอนส่งกลับแก้ไข หรือใน Drive)` : files.length ? " · แนบไฟล์แล้ว" : "");
      $("createForm").reset();
      assignPile.clear();
      filterBuildings([]);
      onCreated();
    } catch (err) { $("createMsg").textContent = "Error: " + err.message; }
    saving = false;
    btn.disabled = false;
    btn.textContent = label;
  };
}

/** admin/tasks.html: sheet warnings, review queue (อนุมัติ / ไม่อนุมัติ) and all tasks with filters. */
async function initTracking() {
  $("status").hidden = true;
  $("page").hidden = false;
  members = await api("listMembers");
  $("fOwner").append(...members.map((m) => option(m.line_user_id, m.staff_name || m.display_name)));
  await loadBuildings();
  for (const id of ["fOwner", "fBuilding", "fState", "fOverdue"]) $(id).onchange = () => { allPage = 0; loadList(); };
  const top = () => $("allList").closest(".card").scrollIntoView({ block: "start" });
  $("allPrev").onclick = () => { allPage--; renderAll(); top(); };
  $("allNext").onclick = () => { allPage++; renderAll(); top(); };
  $("fQ").oninput = () => { allPage = 0; renderAll(); };
  reviewWatch = autoRefresh({ box: $("reviewList").closest(".card"), load: reviewData, draw: drawReview });
  listWatch = autoRefresh({ box: $("allList").closest(".card"), load: listData, draw: drawList });
  $("searchBtn").onclick = () => {
    const on = $("fQ").hidden; // opening
    $("fQ").hidden = !on;
    $("searchBtn").setAttribute("aria-expanded", String(on));
    if (on) $("fQ").focus();
    else if ($("fQ").value) { $("fQ").value = ""; allPage = 0; renderAll(); } // closing clears the search
  };
  loadAll();
}

/** Reports page: performance by month or quarter (members get only their own row from the server). */
/**
 * Month / quarter picker from three selects `${p}Kind`, `${p}Year`, `${p}N` (quarter first = default, this period
 * selected). Years shown in พ.ศ. (value stays ค.ศ.). Any change calls onChange. Returns () => { from, to } (YYYY-MM-DD).
 */
function periodPicker(p, onChange) {
  const [y, m] = bkkToday().split("-").map(Number);
  const kind = $(p + "Kind"), year = $(p + "Year"), n = $(p + "N");
  year.replaceChildren(...Array.from({ length: y - 2020 + 1 }, (_, i) => y - i).map((yy) => option(yy, String(yy + 543)))); // back to 2020 (2563)
  const fillN = () => {
    const month = kind.value === "month";
    n.replaceChildren(...(month
      ? TH_MONTHS.map((name, i) => option(i + 1, name))
      : [1, 2, 3, 4].map((q) => option(q, `ไตรมาส ${q} (${TH_SHORT[q * 3 - 3]}–${TH_SHORT[q * 3 - 1]})`))));
    n.value = month ? m : Math.ceil(m / 3);
  };
  fillN();
  // changing any dropdown reloads straight away, so nothing shows a different period than the picks
  kind.onchange = () => { fillN(); onChange(); };
  year.onchange = n.onchange = onChange;
  return () => {
    const yy = Number(year.value), first = kind.value === "month" ? Number(n.value) : (Number(n.value) - 1) * 3 + 1;
    const iso = (mm, d) => new Date(Date.UTC(yy, mm - 1, d)).toISOString().slice(0, 10);
    return { from: iso(first, 1), to: iso(first + (kind.value === "month" ? 1 : 3), 0) }; // day 0 = last day of the month before
  };
}

function initReports() {
  $("status").hidden = true;
  $("page").hidden = false;
  const reload = () => loadPerformance().catch((e) => { $("perfTable").textContent = "Error: " + e.message; });
  periodPicker("p", reload);
  reload();
  // scores move when tasks are approved: refreshed by itself, but not while a person's task list is open under the table
  autoRefresh({ box: $("perfTable").closest(".card"), load: perfData, draw: (res) => loadPerformance(res), busy: () => !$("perfDetail").hidden });
}

/**
 * Home (admins): ข้อมูลการมอบหมาย — each หัวหน้างาน with the buildings they look after.
 * Move a building: drag its chip onto another person (desktop), or tap the chip then tap the person (phones,
 * where drag-and-drop does not work in the LINE browser). onChange refreshes the assign form's building list.
 */
async function initResponsibilities(onChange) {
  const { people, buildings: rows } = await api("listResponsibilities");
  const NONE = ""; // drop target for "no one looks after it"
  let picked = null; // chip chosen by tap, waiting for a target row
  let editing = false; // edit mode: off until the admin turns it on, so nothing moves by accident

  const zones = new Map(); // owner name -> chip container
  const row = (owner, label) => {
    const chips = el("div", { className: "resp-chips" });
    const head = el("button", { type: "button", className: "resp-name" + (owner === NONE ? " none" : ""), textContent: label });
    const r = el("div", { className: "resp-row" }, head, chips);
    r.dataset.owner = owner;
    zones.set(owner, chips);
    // drop target: drag over / drop, or tap the row while a chip is picked
    r.addEventListener("dragover", (e) => { if (!editing) return; e.preventDefault(); r.classList.add("over"); });
    r.addEventListener("dragleave", () => r.classList.remove("over"));
    r.addEventListener("drop", (e) => { e.preventDefault(); r.classList.remove("over"); if (editing) move(e.dataTransfer.getData("text/plain"), owner); });
    r.addEventListener("click", (e) => { if (editing && picked && !e.target.closest(".resp-chip")) move(picked, owner); });
    return r;
  };
  const known = new Set(people);
  const list = [row(NONE, "ยังไม่มีผู้ดูแล · Unassigned"), ...people.map((p) => row(p, p))];

  const chipFor = (b) => {
    const c = el("button", { type: "button", className: "resp-chip", textContent: b.name, draggable: false, title: b.type || "" });
    c.dataset.building = b.name;
    c.addEventListener("dragstart", (e) => { if (!editing) return e.preventDefault(); e.dataTransfer.setData("text/plain", b.name); e.dataTransfer.effectAllowed = "move"; c.classList.add("dragging"); });
    c.addEventListener("dragend", () => c.classList.remove("dragging"));
    c.addEventListener("click", () => { if (editing) pick(picked === b.name ? null : b.name); });
    return c;
  };
  for (const b of rows) zones.get(known.has(b.owner) ? b.owner : NONE).append(chipFor(b)); // an unknown name counts as unassigned
  const count = () => list.forEach((r) => {
    const n = zones.get(r.dataset.owner).children.length;
    r.querySelector(".resp-name").dataset.count = n;
  });

  function pick(name) {
    picked = name;
    $("respList").querySelectorAll(".resp-chip").forEach((c) => c.classList.toggle("picked", c.dataset.building === name));
    $("respList").classList.toggle("picking", !!name);
    $("respPicked").hidden = !name;
    $("respPicked").textContent = name ? `เลือก "${name}" แล้ว · แตะแถวหัวหน้างานที่จะย้ายไป (แตะซ้ำเพื่อยกเลิก)` : "";
  }

  async function move(name, owner) {
    pick(null);
    const chip = [...$("respList").querySelectorAll(".resp-chip")].find((c) => c.dataset.building === name);
    if (!chip || chip.parentElement === zones.get(owner)) return;
    const from = chip.parentElement;
    // show it moved straight away; put it back if the sheet refuses
    const zone = zones.get(owner);
    const after = [...zone.children].find((c) => c.dataset.building.localeCompare(name, "th") > 0);
    zone.insertBefore(chip, after ?? null);
    chip.classList.add("saving");
    count();
    try {
      await api("setBuildingOwner", { building: name, owner_name: owner });
      onChange?.();
    } catch (err) {
      from.append(chip);
      count();
      alert(err.message);
    }
    chip.classList.remove("saving");
  }

  function setEditing(on) {
    editing = on;
    pick(null);
    $("respList").querySelectorAll(".resp-chip").forEach((c) => { c.draggable = on; c.tabIndex = on ? 0 : -1; });
    $("respList").classList.toggle("editing", on);
    $("respCard").classList.toggle("resp-editing", on);
    $("respEdit").textContent = on ? "✓ เสร็จสิ้น" : "✎ เปิดโหมดแก้ไข";
    $("respEdit").className = "small " + (on ? "" : "secondary");
    $("respEdit").setAttribute("aria-pressed", String(on));
    $("respHelp").textContent = on
      ? "โหมดแก้ไข: ลากนิติบุคคลไปวางที่หัวหน้างานคนใหม่ · บนมือถือ: แตะนิติบุคคล แล้วแตะแถวหัวหน้างาน"
      : "ดูอย่างเดียว · กด \"เปิดโหมดแก้ไข\" ก่อนย้ายนิติบุคคล";
  }
  $("respEdit").onclick = () => setEditing(!editing);

  // new building lands in "Unassigned"; drag it to a หัวหน้างาน in edit mode
  $("addBuildingBtn").onclick = async () => {
    const name = $("newBuilding").value.trim();
    const btn = $("addBuildingBtn");
    if (!name || btn.disabled) return;
    if ([...$("respList").querySelectorAll(".resp-chip")].some((c) => c.dataset.building === name)) return void alert(`มี "${name}" อยู่แล้ว`);
    btn.disabled = true; // a double click would pass the server's "exists?" check twice and append two rows
    try {
      const b = await api("addBuilding", { name, owner_name: NONE });
      $("newBuilding").value = "";
      const c = chipFor(b);
      c.draggable = editing;
      c.tabIndex = editing ? 0 : -1;
      zones.get(NONE).append(c);
      count();
      onChange?.();
    } catch (err) { alert(err.message); }
    btn.disabled = false;
  };

  count();
  $("respList").replaceChildren(...list);
  setEditing(false); // every time the card opens it starts locked
}

// ---- Reports (admins): tasks assigned vs sends over time, one line each, for everyone or one person ----
// Colors checked with the dataviz validator on the dark card surface (#0b0d10): blue = assigned, orange = sent.
const AC_SERIES = [{ key: "a", label: "มอบหมาย · Assigned", color: "#3987e5" }, { key: "s", label: "ส่งงาน · Sent", color: "#d95926" }];
const bkkDay = (iso) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso)) : "");
const TH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** Day keys "YYYY-MM-DD" of the chosen month / quarter, stopping at today while it is still running (Bangkok). */
function activityBins({ from, to }) {
  const today = bkkToday(), end = from <= today && today < to ? today : to;
  const out = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const binLabel = (k) => (k.length === 7 ? `${TH_SHORT[Number(k.slice(5)) - 1]} ${String(Number(k.slice(0, 4)) + 543).slice(2)}` : `${k.slice(8)}/${k.slice(5, 7)}`);
const binTitle = (k) => (k.length === 7 ? `${TH_MONTHS[Number(k.slice(5)) - 1]} ${Number(k.slice(0, 4)) + 543}` : dateText(k));

async function initActivityChart() {
  const tasks = await api("listTasks", {});
  // people who own tasks (incl. revoked), so their history still shows
  const owners = [...new Map(tasks.map((t) => [t.owner, t.owner_name])).entries()].sort((a, b) => a[1].localeCompare(b[1], "th"));
  $("acPerson").replaceChildren(option("", "ทั้งหมด · Everyone"), ...owners.map(([id, name]) => option(id, name)));
  const period = periodPicker("ac", () => draw());
  const draw = () => drawActivity(tasks, $("acPerson").value, period());
  $("acPerson").onchange = draw;
  let lastWidth = 0;
  new ResizeObserver(() => { const w = $("acChart").clientWidth; if (w && w !== lastWidth) { lastWidth = w; draw(); } }).observe($("acChart"));
  draw();
}

function drawActivity(tasks, person, range) {
  const keys = activityBins(range), at = new Map(keys.map((k, i) => [k, i])), cut = (d) => d;
  const a = keys.map(() => 0), s = keys.map(() => 0);
  for (const t of tasks) {
    if (person && t.owner !== person) continue;
    const i = at.get(cut(bkkDay(t.created_at)));
    if (i !== undefined) a[i]++;
    for (const x of t.sends) { const j = at.get(cut(x.sent_on || "")); if (j !== undefined) s[j]++; }
  }
  // running totals: each line counts up from 0 at the start of the chosen range (and restarts when the range changes)
  const running = (v) => { let sum = 0; return v.map((n) => (sum += n)); };
  const daily = { a, s }, data = { a: running(a), s: running(s) };
  $("acLegend").replaceChildren(...AC_SERIES.map((sr) => el("span", { className: "ac-key" },
    el("i", { style: `--c:${sr.color}` }), `${sr.label} สะสม `, el("strong", { textContent: data[sr.key].at(-1) }))));

  // geometry
  const box = $("acChart"), W = Math.max(box.clientWidth, 280), H = 240, L = 34, R = 14, T = 14, B = 30;
  const top = Math.max(4, ...data.a, ...data.s), step = Math.ceil(top / 4), max = step * 4;
  const x = (i) => L + (keys.length === 1 ? 0 : (i * (W - L - R)) / (keys.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
  const root = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "ac-svg", role: "img", "aria-label": `${AC_SERIES[0].label} สะสม ${data.a.at(-1)}, ${AC_SERIES[1].label} สะสม ${data.s.at(-1)}` });
  for (let v = 0; v <= max; v += step) { // recessive grid + y labels
    root.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v ? "ac-grid" : "ac-base" }), svg("text", { x: L - 8, y: y(v) + 4, class: "ac-y" }, v));
  }
  const every = Math.ceil(keys.length / 6); // ~6 x labels, always the last one
  keys.forEach((k, i) => { if ((keys.length - 1 - i) % every === 0) root.append(svg("text", { x: x(i), y: H - 8, class: "ac-x" }, binLabel(k))); });
  for (const sr of AC_SERIES) {
    root.append(svg("polyline", { points: data[sr.key].map((v, i) => `${x(i)},${y(v)}`).join(" "), class: "ac-line", stroke: sr.color }));
    const li = keys.length - 1; // end dot carries the series color
    root.append(svg("circle", { cx: x(li), cy: y(data[sr.key][li]), r: 4, fill: sr.color, class: "ac-end" }));
  }
  // hover / tap: crosshair + dots + tooltip on the nearest point
  const cross = svg("line", { y1: T, y2: H - B, class: "ac-cross", visibility: "hidden" });
  const dots = AC_SERIES.map((sr) => svg("circle", { r: 5, fill: sr.color, class: "ac-dot", visibility: "hidden" }));
  const hit = svg("rect", { x: L, y: 0, width: W - L - R, height: H - B, fill: "transparent", class: "ac-hit" });
  root.append(cross, ...dots, hit);
  const tip = el("div", { className: "ac-tip", hidden: true });
  const show = (ev) => {
    const r = root.getBoundingClientRect(), px = ev.clientX - r.left;
    const i = Math.max(0, Math.min(keys.length - 1, Math.round(((px - L) / (W - L - R)) * (keys.length - 1))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    AC_SERIES.forEach((sr, n) => { dots[n].setAttribute("cx", x(i)); dots[n].setAttribute("cy", y(data[sr.key][i])); dots[n].setAttribute("visibility", "visible"); });
    tip.replaceChildren(el("strong", { textContent: binTitle(keys[i]) }),
      ...AC_SERIES.map((sr) => el("div", {}, el("i", { style: `--c:${sr.color}` }), `${sr.label.split(" · ")[0]} สะสม `, el("b", { textContent: data[sr.key][i] }),
        el("span", { className: "muted", textContent: ` (+${daily[sr.key][i]})` }))));
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(x(i) + 12, 0), W - 220) + "px";
    tip.style.top = "8px";
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
  box.replaceChildren(root, tip);

  // the same numbers as a table (accessibility + exact values)
  $("acTable").replaceChildren(el("table", {},
    el("tr", {}, el("th", { textContent: "วันที่" }), ...AC_SERIES.map((sr) => el("th", { textContent: `${sr.label} (+ใหม่ · สะสม)` }))),
    ...keys.map((k, i) => el("tr", {}, el("td", { textContent: binTitle(k) }), el("td", { textContent: `+${a[i]} · ${data.a[i]}` }), el("td", { textContent: `+${s[i]} · ${data.s[i]}` }))).reverse()));
}
