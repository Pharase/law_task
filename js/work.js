// Member Work dashboard (spec "Member view"). Needs js/app.js (api, uploadFile, $).
const OUTCOME_TEXT = { pending: "รอตรวจ", approved: "อนุมัติ", void: "กดผิด", fix: "มีปรับแก้" };
const bkkToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const thDate = (s) => (s ? new Date(s + "T00:00:00+07:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-");

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
  const overdue = task.state === "on_process" && task.current_due_on < today;
  const fix = task.state === "on_process" ? lastFix(task) : null;
  const summary = el("summary", {},
    el("strong", { textContent: task.title }),
    el("span", { className: "muted", textContent: ` · ${task.building}${opts.admin ? " · " + task.owner_name : ""} · กำหนดส่ง ${thDate(task.current_due_on)}` }),
    opts.status && el("span", { className: "badge", textContent: opts.status }),
    overdue && el("span", { className: "badge late", textContent: "เลยกำหนด" }),
    task.fix_round > 0 && el("span", { className: "badge", textContent: `รอบแก้ ${task.fix_round}` }),
    task.fix_round > 5 && el("span", { className: "badge late", textContent: "เกิน 5 รอบแก้ไข" }),
  );

  const body = el("div", { className: "task-body" },
    task.details && el("p", { className: "pre", textContent: task.details }),
    el("p", {}, ...task.tags.map((t) => el("span", { className: "tag", textContent: t }))),
    el("p", { className: "muted", textContent: `กำหนดส่งเดิม ${thDate(task.due_on)}` +
      (task.current_due_on !== task.due_on ? ` · กำหนดส่งปัจจุบัน ${thDate(task.current_due_on)}` : "") }),
    fix && el("div", { className: "fix-note" },
      el("strong", { textContent: "สิ่งที่ต้องแก้ไข: " }), el("span", { className: "pre", textContent: fix.fix_note ?? "" })),
  );

  if (task.sends.length) {
    body.append(el("p", { className: "label", textContent: "ประวัติ" }), el("ol", { className: "timeline" },
      ...task.sends.map((s) => el("li", {},
        `ส่ง ${thDate(s.sent_on)} (กำหนด ${thDate(s.due_on)}) → ${OUTCOME_TEXT[s.outcome] ?? s.outcome}`,
        s.fix_note ? el("div", { className: "muted pre", textContent: s.fix_note }) : null,
      ))));
  }

  if (task.files.length) {
    body.append(el("p", { className: "label", textContent: "ไฟล์แนบ" }), el("ul", {},
      ...task.files.map((f) => el("li", {}, f.url
        ? el("a", { href: f.url, target: "_blank", textContent: f.name })
        : el("span", { className: "muted", textContent: `${f.name} (ลบหลังสำรองข้อมูลแล้ว)` })))));
  }

  if (task.state === "on_process" && !opts.admin) {
    const input = el("input", { type: "file", multiple: true, accept: "image/*,application/pdf" });
    const msg = el("p", { role: "status" });
    const btn = el("button", { type: "button", textContent: "ส่งงาน (Send)" });
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const ids = [];
        for (const [i, f] of [...input.files].entries()) {
          msg.textContent = `กำลังอัปโหลด ${i + 1}/${input.files.length}…`;
          ids.push((await uploadFile(f)).id);
        }
        msg.textContent = "กำลังส่ง…";
        await api("sendTask", { task_id: task.id, file_ids: ids });
        onChange();
      } catch (err) {
        msg.textContent = "Error: " + err.message;
        btn.disabled = false;
      }
    };
    body.append(el("label", { textContent: "แนบไฟล์ (ไม่บังคับ)" }), input, btn, msg);
  }

  return el("details", { className: "task" + (overdue ? " overdue" : "") }, summary, body);
}


// ---- Home dashboard (members: own tasks; admins: whole team) ----
// Donut = tasks ASSIGNED this month (Bangkok), by status. Older unfinished tasks sit in "งานคงค้างอื่นๆ"; older finished ones leave Home.
// Colors checked with the dataviz palette validator (light, white surface, ring order incl. the wrap-around pair);
// amber and aqua are below 3:1 on white, so the legend always names and counts every status.
const TAG_LIST = ["ความถูกต้อง", "เสนออนุมัติ/ลงนามกรรมการ", "การประสานงาน", "ติดตามความคืบหน้าคดี"];
const HOME_STATUS = [
  { key: "todo", label: "รอดำเนินการ", color: "#2a78d6" },
  { key: "fix", label: "รอแก้ไข", color: "#e34948" },
  { key: "review", label: "รอตรวจสอบ", color: "#eda100" },
  { key: "ontime", label: "เสร็จสิ้น · ส่งตรงเวลา", color: "#1baf7a" },
  { key: "late", label: "เสร็จสิ้น · ส่งล่าช้า", color: "#eb6834" },
];
const bkkMonth = (iso) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso)).slice(0, 7) : "");

/** Status key for Home. "late" = the approved send came after that round's due date. */
function homeStatus(t) {
  if (t.state === "approved") {
    const last = t.sends.filter((s) => s.outcome === "approved").at(-1);
    return last && last.sent_on > t.current_due_on ? "late" : "ontime";
  }
  if (t.state === "submitted") return "review";
  return t.fix_round > 0 ? "fix" : "todo";
}

function donut(parts, total, onPick) {
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const R = 48, C = 2 * Math.PI * R, GAP = 1.5; // ~2px surface gap between segments at 160px
  const svg = svgEl("svg", { viewBox: "0 0 120 120", class: "donut", role: "img", "aria-label": `งานเดือนนี้ ${total}` });
  svg.append(svgEl("circle", { cx: 60, cy: 60, r: R, class: "donut-track" }));
  const shown = parts.filter((p) => p.n);
  const segs = new Map();
  let offset = 0;
  for (const p of shown) {
    const len = (p.n / total) * C;
    const seg = svgEl("circle", {
      cx: 60, cy: 60, r: R, class: "donut-seg", stroke: p.color, transform: "rotate(-90 60 60)",
      "stroke-dasharray": `${Math.max(len - (shown.length > 1 ? GAP : 0), 0.5)} ${C}`, "stroke-dashoffset": -offset,
    });
    seg.addEventListener("click", () => onPick(p));
    seg.addEventListener("mouseenter", () => center(p));
    seg.addEventListener("mouseleave", () => center(null));
    segs.set(p, seg);
    svg.append(seg);
    offset += len;
  }
  const big = svgEl("text", { x: 60, y: 58, class: "donut-num" });
  const small = svgEl("text", { x: 60, y: 76, class: "donut-sub" });
  svg.append(big, small);
  function center(p) {
    big.textContent = p ? p.n : total;
    small.textContent = p ? `${p.label.split(" · ").at(-1)} ${Math.round((p.n / total) * 100)}%` : "งานเดือนนี้";
    for (const [q, seg] of segs) seg.classList.toggle("dim", !!p && q !== p);
  }
  center(null);
  return { svg, center };
}

async function renderHome(me) {
  const today = bkkToday(), month = today.slice(0, 7);
  const isAdmin = me.role === "admin";
  const reload = () => renderHome(me);
  const all = (isAdmin ? await api("listTasks", {}) : await api("myTasks")).filter((t) => t.state !== "cancelled");
  const thisMonth = all.filter((t) => bkkMonth(t.created_at) === month);
  const older = all.filter((t) => bkkMonth(t.created_at) !== month && t.state !== "approved");
  const parts = HOME_STATUS.map((s) => ({ ...s, tasks: thisMonth.filter((t) => homeStatus(t) === s.key) })).map((p) => ({ ...p, n: p.tasks.length }));
  const backlog = { key: "older", label: "งานคงค้างอื่นๆ", color: "#9a9a94", tasks: older, n: older.length };

  $("dashTitle").textContent = `${isAdmin ? "ภาพรวมงานทีม" : "ภาพรวมงานของฉัน"} · ${new Date(today + "T00:00:00+07:00").toLocaleDateString("th-TH", { month: "long", year: "numeric" })}`;
  const statusText = Object.fromEntries(HOME_STATUS.map((s) => [s.key, s.label]));
  let selected = null;
  const pick = (p) => {
    selected = p;
    for (const row of legend.children) row.classList.toggle("selected", row.dataset.key === p.key);
    $("dashListTitle").textContent = `${p.label} (${p.n})`;
    const sorted = [...p.tasks].sort((a, b) => a.current_due_on.localeCompare(b.current_due_on));
    $("dashList").replaceChildren(...(sorted.length
      ? sorted.map((t) => taskItem(t, today, reload, { admin: isAdmin, status: statusText[homeStatus(t)] }))
      : [el("p", { className: "muted", textContent: "ไม่มีงาน" })]));
  };

  const chart = thisMonth.length ? donut(parts, thisMonth.length, pick) : null;
  // The legend is also the table view: every status with its count and share, even when 0, plus the backlog row.
  const row = (p, share) => {
    const li = el("li", { tabIndex: 0 },
      el("span", { className: "swatch" + (p === backlog ? " hollow" : ""), style: `--c:${p.color}` }),
      el("span", { className: "grow", textContent: p.label }),
      el("strong", { textContent: p.n }),
      el("span", { className: "muted pct", textContent: share }));
    li.dataset.key = p.key;
    li.onclick = () => pick(p);
    li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(p); } };
    if (chart && p !== backlog) { li.onmouseenter = li.onfocus = () => chart.center(p); li.onmouseleave = li.onblur = () => chart.center(null); }
    return li;
  };
  const legend = el("ul", { className: "legend" },
    ...parts.map((p) => row(p, thisMonth.length ? `${Math.round((p.n / thisMonth.length) * 100)}%` : "-")),
    row(backlog, ""));
  legend.lastChild.classList.add("backlog");
  $("dashChart").replaceChildren(chart ? chart.svg : el("p", { className: "muted donut-empty", textContent: "ยังไม่มีงานที่มอบหมายเดือนนี้" }), legend);

  // Open the list people most likely need: work to fix or do first, then waiting review, then the backlog.
  pick([parts[1], parts[0], parts[2], backlog].find((p) => p.n) ?? parts[0]);
}
