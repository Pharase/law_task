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
    $(id).textContent = row ? `${row.overall5.toFixed(2)} / 5 (${row.tasks} งาน)` : "-";
  };
  const [month, quarter] = await Promise.all([
    api("performance", { kind: "month", year: y, n: m }),
    api("performance", { kind: "quarter", year: y, n: Math.ceil(m / 3) }),
  ]);
  show("perfMonth", month);
  show("perfQuarter", quarter);
}

async function renderWork(me) {
  const today = bkkToday();
  const reload = () => renderWork(me);
  const tasks = await api("myTasks");
  const by = (state) => tasks.filter((t) => t.state === state);
  fill("activeList", "activeCount", by("on_process").sort((a, b) => a.current_due_on.localeCompare(b.current_due_on)), today, reload, "ไม่มีงานค้าง");
  fill("waitingList", "waitingCount", by("submitted"), today, reload, "ไม่มีงานรอตรวจ");
  fill("doneList", null, by("approved").sort((a, b) => (b.sends.at(-1)?.sent_at ?? "").localeCompare(a.sends.at(-1)?.sent_at ?? "")), today, reload, "ยังไม่มีงานที่อนุมัติ");
  $("perfCard").hidden = me.role !== "member"; // admins don't own tasks
  if (me.role === "member") renderPerformance(today).catch(() => { $("perfMonth").textContent = "-"; });
}
