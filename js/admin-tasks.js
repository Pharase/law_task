// Task screens: assign form (Home, admins), tracking page (admin/tasks.html), performance table (Reports).
// Needs js/app.js and js/work.js (el, thDate, bkkToday, OUTCOME_TEXT, TAG_LIST).
const STATE_TEXT = { on_process: "On Process", submitted: "รอตรวจ", approved: "อนุมัติ", cancelled: "ยกเลิก" };
let buildings = [], members = [];

const option = (value, text) => el("option", { value, textContent: text });
const check = (name, value, text) => el("label", { className: "inline" }, el("input", { type: "checkbox", name, value }), " " + text);
const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

/** Read-only task summary shared by the review queue and the all-tasks list. */
function adminTaskBody(t) {
  const files = t.files.map((f) => f.url
    ? el("li", {}, el("a", { href: f.url, target: "_blank", textContent: f.name }))
    : el("li", { className: "muted", textContent: f.name + " (ลบแล้ว)" }));
  return el("div", { className: "task-body" },
    el("p", { className: "muted", textContent: `${t.owner_name} · ${STATE_TEXT[t.state]} · เดิม ${thDate(t.due_on)} · ปัจจุบัน ${thDate(t.current_due_on)}` }),
    t.details && el("p", { className: "pre", textContent: t.details }),
    el("p", {}, ...t.tags.map((x) => el("span", { className: "tag", textContent: x }))),
    t.sends.length > 0 && el("ol", { className: "timeline" }, ...t.sends.map((s) => el("li", {},
      `ส่ง ${thDate(s.sent_on)} (กำหนด ${thDate(s.due_on)}) → ${OUTCOME_TEXT[s.outcome]}`,
      s.fix_note ? el("div", { className: "muted pre", textContent: s.fix_note }) : null))),
    files.length > 0 && el("ul", {}, ...files),
  );
}

function summaryLine(t) {
  const overdue = t.state === "on_process" && t.current_due_on < bkkToday();
  return el("summary", {},
    el("strong", { textContent: t.title }),
    el("span", { className: "muted", textContent: ` · ${t.building} · ${t.owner_name} · ${thDate(t.current_due_on)}` }),
    overdue && el("span", { className: "badge late", textContent: "เลยกำหนด" }),
    t.fix_round > 0 && el("span", { className: "badge", textContent: `รอบแก้ ${t.fix_round}` }),
    t.fix_round > 5 && el("span", { className: "badge late", textContent: "เกิน 5 รอบแก้ไข" }));
}

function reviewControls(t) {
  const msg = el("p", { role: "alert", className: "error" });
  const reason = el("select", { required: true }, option("", "เลือกเหตุผล"), option("กดผิด", "กดผิด"), option("มีปรับแก้", "มีปรับแก้"));
  const note = el("textarea", { rows: 3, maxLength: 2000, placeholder: "ระบุส่วนที่ต้องแก้ไข" });
  const due = el("input", { type: "date", min: bkkToday() });
  const fixBox = el("div", { hidden: true }, el("label", { textContent: "สิ่งที่ต้องแก้ไข" }), note, el("label", { textContent: "กำหนดส่งแก้" }), due);
  const notForm = el("form", { hidden: true }, el("label", { textContent: "เหตุผล" }), reason, fixBox, el("button", { textContent: "ยืนยันไม่อนุมัติ" }));
  reason.onchange = () => {
    const fix = reason.value === "มีปรับแก้";
    fixBox.hidden = !fix;
    note.required = due.required = fix;
  };
  const submit = async (payload) => {
    msg.textContent = "";
    try { await api("reviewTask", { task_id: t.id, ...payload }); }
    catch (err) {
      if (/already reviewed/.test(err.message)) alert("งานนี้ถูกตรวจโดยแอดมินคนอื่นแล้ว (already reviewed by another admin)");
      else return void (msg.textContent = err.message);
    }
    loadAll();
  };
  notForm.onsubmit = (e) => {
    e.preventDefault();
    submit({ decision: reason.value, note: note.value, next_due_on: due.value });
  };
  const approve = el("button", { type: "button", className: "small", textContent: "อนุมัติ (Approved)" });
  approve.onclick = () => submit({ decision: "approved" });
  const reject = el("button", { type: "button", className: "small danger", textContent: "ไม่อนุมัติ (Not approved)" });
  reject.onclick = () => { notForm.hidden = false; };
  return el("div", {}, approve, reject, notForm, msg);
}

function editControls(t) {
  if (t.sends.length || t.state !== "on_process") return null;
  const title = el("input", { value: t.title, maxLength: 200, required: true });
  const due = el("input", { type: "date", value: t.current_due_on, min: bkkToday(), required: true });
  const form = el("form", { hidden: true }, el("label", { textContent: "หัวข้อ" }), title, el("label", { textContent: "กำหนดส่ง" }), due,
    el("button", { textContent: "บันทึก" }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api("editTask", { task_id: t.id, title: title.value, due_on: due.value }); loadAll(); }
    catch (err) { alert(err.message); }
  };
  const edit = el("button", { type: "button", className: "small secondary", textContent: "แก้ไข" });
  edit.onclick = () => { form.hidden = !form.hidden; };
  const cancel = el("button", { type: "button", className: "small danger", textContent: "ยกเลิกงาน" });
  cancel.onclick = async () => {
    if (!confirm(`ยกเลิกงาน "${t.title}"?`)) return;
    try { await api("cancelTask", { task_id: t.id }); loadAll(); } catch (err) { alert(err.message); }
  };
  return el("div", {}, edit, cancel, form);
}

async function loadReview() {
  const list = (await api("listTasks", { state: "submitted" }))
    .sort((a, b) => (a.sends.at(-1)?.sent_at ?? "").localeCompare(b.sends.at(-1)?.sent_at ?? ""));
  $("reviewCount").textContent = list.length;
  $("reviewList").replaceChildren(...(list.length
    ? list.map((t) => el("details", { className: "task", open: true }, summaryLine(t), adminTaskBody(t), reviewControls(t)))
    : [el("p", { className: "muted", textContent: "ไม่มีงานรอตรวจ" })]));
}

async function loadList() {
  const list = await api("listTasks", {
    owner: $("fOwner").value || undefined,
    building: $("fBuilding").value || undefined,
    state: $("fState").value || undefined,
    overdue: $("fOverdue").checked || undefined,
  });
  $("allList").replaceChildren(...(list.length
    ? list.map((t) => el("details", { className: "task" }, summaryLine(t), adminTaskBody(t), editControls(t)))
    : [el("p", { className: "muted", textContent: "ไม่พบงาน" })]));
}

async function loadPerformance() {
  const res = await api("performance", { kind: $("pKind").value, year: Number($("pYear").value), n: Number($("pN").value) });
  const pct = (x) => (x * 100).toFixed(1) + "%"; // raw score: average task score / 10
  const head = el("tr", {}, ...["ชื่อ", "งาน", "คะแนน (1–5)", "ดิบ (raw)", ...TAG_LIST.map((t) => t + " (1–5 · raw)")].map((h) => el("th", { textContent: h })));
  const rows = res.rows.sort((a, b) => b.overall5 - a.overall5).map((r) => el("tr", {},
    el("td", { textContent: r.name }), el("td", { textContent: r.tasks }), el("td", { textContent: r.overall5.toFixed(2) }), el("td", { textContent: pct(r.overall) }),
    ...TAG_LIST.map((tag) => el("td", { textContent: r.byTag[tag] ? `${r.byTag[tag].scaled.toFixed(2)} · ${pct(r.byTag[tag].raw)}` : "-" }))));
  $("perfTable").replaceChildren(el("caption", { className: "muted", textContent: `${thDate(res.from)} – ${thDate(res.to)}` }), head,
    ...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 4 + TAG_LIST.length, textContent: "ยังไม่มีงานที่อนุมัติในช่วงนี้" }))]));
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
  const opts = (first) => [option("", first), ...buildings.map((b) => option(b.name, b.name))];
  if ($("building")) $("building").replaceChildren(...opts("เลือกนิติบุคคล"));
  if ($("fBuilding")) $("fBuilding").replaceChildren(...opts("ทุกนิติบุคคล"));
  if (selectName) $("building").value = selectName;
}

/** Home (admins): the assign form, shown by the "มอบหมายงาน" button. onCreated refreshes the dashboard. */
async function initAssignForm(onCreated) {
  $("dueOn").min = bkkToday();
  $("tags").replaceChildren(...TAG_LIST.map((t) => check("tag", t, t)));
  members = await api("listMembers");
  $("owners").replaceChildren(...(members.length
    ? members.map((m) => check("owner", m.line_user_id, m.staff_name || m.display_name || m.line_user_id))
    : [el("p", { className: "muted", textContent: "ยังไม่มีสมาชิก (members)" })]));
  await loadBuildings();

  $("addBuildingBtn").onclick = async () => {
    const name = $("newBuilding").value.trim();
    if (!name) return;
    try { const b = await api("addBuilding", { name }); $("newBuilding").value = ""; await loadBuildings(b.name); }
    catch (err) { alert(err.message); }
  };

  $("createForm").onsubmit = async (e) => {
    e.preventDefault();
    const tags = checked("tag"), owners = checked("owner");
    if (!tags.length || !owners.length) return void ($("createMsg").textContent = "เลือกหมวดหมู่และผู้รับงานอย่างน้อย 1");
    try {
      const made = await api("createTask", {
        building: $("building").value, title: $("title").value, details: $("details").value,
        tags, owners, due_on: $("dueOn").value,
      });
      $("createMsg").textContent = `มอบหมายแล้ว ${made.length} งาน`;
      $("createForm").reset();
      onCreated();
    } catch (err) { $("createMsg").textContent = "Error: " + err.message; }
  };
}

/** admin/tasks.html: sheet warnings, review queue (อนุมัติ / ไม่อนุมัติ) and all tasks with filters. */
async function initTracking() {
  $("status").hidden = true;
  $("page").hidden = false;
  members = await api("listMembers");
  $("fOwner").append(...members.map((m) => option(m.line_user_id, m.staff_name || m.display_name)));
  await loadBuildings();
  for (const id of ["fOwner", "fBuilding", "fState", "fOverdue"]) $(id).onchange = () => loadList();
  loadAll();
}

/** Reports page: performance by month or quarter (members get only their own row from the server). */
function initReports() {
  $("status").hidden = true;
  $("page").hidden = false;
  const [y, m] = bkkToday().split("-").map(Number);
  $("pYear").value = y;
  $("pN").value = m;
  $("pKind").onchange = () => { $("pN").max = $("pKind").value === "month" ? 12 : 4; $("pN").value = $("pKind").value === "month" ? m : Math.ceil(m / 3); };
  $("pGo").onclick = () => loadPerformance().catch((e) => alert(e.message));
  loadPerformance().catch((e) => { $("perfTable").textContent = "Error: " + e.message; });
}
