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

function taskItem(task, today, onChange) {
  const overdue = task.state === "on_process" && task.current_due_on < today;
  const fix = task.state === "on_process" ? lastFix(task) : null;
  const summary = el("summary", {},
    el("strong", { textContent: task.title }),
    el("span", { className: "muted", textContent: ` · ${task.building} · กำหนดส่ง ${thDate(task.current_due_on)}` }),
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

  if (task.state === "on_process") {
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

function fill(listId, countId, tasks, today, onChange, empty) {
  $(listId).replaceChildren(...(tasks.length ? tasks.map((t) => taskItem(t, today, onChange)) : [el("p", { className: "muted", textContent: empty })]));
  if (countId) $(countId).textContent = tasks.length;
}

async function renderPerformance(today) {
  const [y, m] = today.split("-").map(Number);
  const show = (id, res) => {
    const row = res.rows[0];
    $(id).textContent = row ? `${row.overall5.toFixed(2)} / 5 · ${(row.overall * 100).toFixed(1)}% (${row.tasks} งาน)` : "-";
  };
  const [month, quarter] = await Promise.all([
    api("performance", { kind: "month", year: y, n: m }),
    api("performance", { kind: "quarter", year: y, n: Math.ceil(m / 3) }),
  ]);
  show("perfMonth", month);
  show("perfQuarter", quarter);
}

// Dashboard donut: the member's tasks by status. Colors checked with the dataviz palette validator (light, white surface);
// green vs red is weak for colorblind readers, so they never touch on the ring and the legend always names + counts.
const TASK_STATUS = [
  { label: "กำลังทำ · On process", color: "#2a78d6", is: (t, today) => t.state === "on_process" && t.current_due_on >= today },
  { label: "เลยกำหนด · Overdue", color: "#e34948", is: (t, today) => t.state === "on_process" && t.current_due_on < today },
  { label: "รอตรวจ · Waiting review", color: "#eda100", is: (t) => t.state === "submitted" },
  { label: "เสร็จแล้ว · Done", color: "#1baf7a", is: (t) => t.state === "approved" },
];

function renderDashboard(tasks, today) {
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const total = tasks.length;
  const parts = TASK_STATUS.map((s) => ({ ...s, n: tasks.filter((t) => s.is(t, today)).length }));
  const R = 48, C = 2 * Math.PI * R, GAP = 1.5; // 2px surface gap between segments at the rendered size
  const svg = svgEl("svg", { viewBox: "0 0 120 120", class: "donut", role: "img", "aria-label": `งานทั้งหมด ${total}` });
  svg.append(svgEl("circle", { cx: 60, cy: 60, r: R, class: "donut-track" }));
  const shown = parts.filter((p) => p.n);
  let offset = 0;
  const segs = new Map();
  for (const p of shown) {
    const len = (p.n / total) * C;
    const seg = svgEl("circle", {
      cx: 60, cy: 60, r: R, class: "donut-seg", stroke: p.color,
      "stroke-dasharray": `${Math.max(len - (shown.length > 1 ? GAP : 0), 0.5)} ${C}`, "stroke-dashoffset": -offset,
      transform: "rotate(-90 60 60)",
    });
    offset += len;
    segs.set(p, seg);
    svg.append(seg);
  }
  const big = svgEl("text", { x: 60, y: 58, class: "donut-num" });
  const small = svgEl("text", { x: 60, y: 76, class: "donut-sub" });
  svg.append(big, small);
  const center = (p) => {
    big.textContent = p ? p.n : total;
    small.textContent = p ? `${p.label.split(" · ")[0]} ${Math.round((p.n / total) * 100)}%` : "งานทั้งหมด";
    for (const [q, seg] of segs) seg.classList.toggle("dim", !!p && q !== p);
  };
  center(null);

  // The legend is also the table view: every status with its count and share, even when 0.
  const legend = el("ul", { className: "legend" }, ...parts.map((p) => {
    const row = el("li", { tabIndex: p.n ? 0 : -1 },
      el("span", { className: "swatch", style: `background:${p.color}` }),
      el("span", { className: "grow", textContent: p.label }),
      el("strong", { textContent: p.n }),
      el("span", { className: "muted pct", textContent: total ? `${Math.round((p.n / total) * 100)}%` : "-" }));
    if (p.n) {
      row.onmouseenter = row.onfocus = () => center(p);
      row.onmouseleave = row.onblur = () => center(null);
      const seg = segs.get(p);
      seg.addEventListener("mouseenter", () => center(p));
      seg.addEventListener("mouseleave", () => center(null));
      seg.addEventListener("click", () => center(p)); // tap on phones
    }
    return row;
  }));
  $("dashChart").replaceChildren(total ? svg : el("p", { className: "muted", textContent: "ยังไม่มีงาน" }), legend);
}

async function renderWork(me) {
  const today = bkkToday();
  const reload = () => renderWork(me);
  const tasks = await api("myTasks");
  renderDashboard(tasks, today);
  const by = (state) => tasks.filter((t) => t.state === state);
  fill("activeList", "activeCount", by("on_process").sort((a, b) => a.current_due_on.localeCompare(b.current_due_on)), today, reload, "ไม่มีงานค้าง");
  fill("waitingList", "waitingCount", by("submitted"), today, reload, "ไม่มีงานรอตรวจ");
  fill("doneList", null, by("approved").sort((a, b) => (b.sends.at(-1)?.sent_at ?? "").localeCompare(a.sends.at(-1)?.sent_at ?? "")), today, reload, "ยังไม่มีงานที่อนุมัติ");
  $("perfCard").hidden = me.role !== "member"; // admins don't own tasks
  if (me.role === "member") renderPerformance(today).catch(() => { $("perfMonth").textContent = "-"; });
}
