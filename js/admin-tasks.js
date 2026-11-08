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
  if ($("fBuilding")) $("fBuilding").replaceChildren(option("", "ทุกนิติบุคคล"), ...buildings.map((b) => option(b.name, b.name)));
  if ($("building")) filterBuildings(selectName);
}

const memberLabel = (m) => (m.staff_name || m.display_name || m.line_user_id).trim();

/**
 * Assign form: show only the buildings the chosen หัวหน้างาน look after (ข้อมูลการมอบหมาย).
 * Same rule as the server (responsibility.ts): someone with no buildings yet is not restricted.
 */
function filterBuildings(keep = $("building").value) {
  const chosen = checked("owner").map((id) => memberLabel(members.find((m) => m.line_user_id === id) ?? { line_user_id: id }));
  const restricted = chosen.filter((n) => buildings.some((b) => b.owner === n));
  const shown = restricted.length ? buildings.filter((b) => restricted.every((n) => b.owner === n)) : buildings;
  $("building").replaceChildren(option("", shown.length ? "เลือกนิติบุคคล" : "— ไม่มีนิติบุคคลที่ดูแลร่วมกัน —"), ...shown.map((b) => option(b.name, b.name)));
  if (shown.some((b) => b.name === keep)) $("building").value = keep;
  $("buildingHint").textContent = !chosen.length ? "เลือกผู้รับงานก่อน เพื่อแสดงเฉพาะนิติบุคคลที่ดูแล"
    : !restricted.length ? "ผู้รับงานที่เลือกยังไม่มีนิติบุคคลในข้อมูลการมอบหมาย · แสดงทั้งหมด"
    : shown.length ? `แสดงเฉพาะนิติบุคคลที่ ${restricted.join(", ")} ดูแล (${shown.length})`
    : "ผู้รับงานที่เลือกไม่มีนิติบุคคลที่ดูแลร่วมกัน · มอบหมายทีละคน";
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
  $("owners").addEventListener("change", () => filterBuildings());

  $("addBuildingBtn").onclick = async () => {
    const name = $("newBuilding").value.trim();
    if (!name) return;
    // one person chosen: the new building goes straight into their responsibility
    const one = checked("owner").length === 1 ? memberLabel(members.find((m) => m.line_user_id === checked("owner")[0])) : "";
    try { const b = await api("addBuilding", { name, owner_name: one }); $("newBuilding").value = ""; await loadBuildings(b.name); }
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
      filterBuildings("");
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
  // dropdowns: years shown in พ.ศ. (value stays ค.ศ. for the server), Thai month names, quarters with their months
  const SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  $("pYear").replaceChildren(...Array.from({ length: y - 2024 + 1 }, (_, i) => y - i) // this year back to 2024 (2567)
    .map((yy) => option(yy, String(yy + 543))));
  const fillN = (n) => {
    const month = $("pKind").value === "month";
    $("pN").replaceChildren(...(month
      ? TH_MONTHS.map((name, i) => option(i + 1, name))
      : [1, 2, 3, 4].map((q) => option(q, `ไตรมาส ${q} (${SHORT[q * 3 - 3]}–${SHORT[q * 3 - 1]})`))));
    $("pN").value = n;
  };
  const reload = () => loadPerformance().catch((e) => { $("perfTable").textContent = "Error: " + e.message; });
  fillN(m);
  // changing any dropdown reloads straight away, so the table never shows a different period than the picks
  $("pKind").onchange = () => { fillN($("pKind").value === "month" ? m : Math.ceil(m / 3)); reload(); };
  $("pYear").onchange = $("pN").onchange = reload;
  reload();
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

  count();
  $("respList").replaceChildren(...list);
  setEditing(false); // every time the card opens it starts locked
}
