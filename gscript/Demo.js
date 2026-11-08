// Demo data for testing the app. Run from the Apps Script editor:
//   seedDemo   — adds demo buildings, tasks (+ sends), invoices and news
//   clearDemo  — deletes exactly those rows again
// Demo rows are marked: created_by = "demo" (Tasks, Invoices, News), Sends of demo tasks, Buildings named "DEMO …".
// Tasks go to the real members in the Members tab (open an admin page in the app once to fill it): the app only shows
// tasks whose owner_name is a real person. They are marked as already notified, so the daily LINE summary skips them.

var DEMO = "demo";
var DEMO_TAGS = ["ความถูกต้อง", "เสนออนุมัติ/ลงนามกรรมการ", "การประสานงาน", "ติดตามความคืบหน้าคดี"];
var DEMO_TITLES = ["ตรวจสัญญาเช่า", "ร่างหนังสือแจ้งค้างชำระ", "สรุปมติที่ประชุมใหญ่", "ติดตามคดีฟ้องเรียก", "ตรวจระเบียบนิติบุคคล",
  "เตรียมเอกสารจดทะเบียน", "ทำหนังสือมอบอำนาจ", "ตรวจรายงานงบการเงิน", "ติดต่อสำนักงานที่ดิน", "ร่างประกาศนิติบุคคล"];

/** Pure: the demo rows for `today` (YYYY-MM-DD, Bangkok). members = [{line_user_id, name}] of role member. */
function demoPlan(today, members, nowIso) {
  var add = function (iso, n) { var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var at9 = function (iso) { return new Date(iso + "T02:00:00Z").toISOString(); }; // 09:00 in Bangkok
  var people = members.slice(0, 4);
  var types = ["บ้านจัดสรร", "อาคารชุด"];
  var buildings = [];
  people.forEach(function (p, i) {
    buildings.push({ name: "DEMO อาคาร " + (i * 2 + 1), type: types[i % 2], owner: p.name });
    buildings.push({ name: "DEMO อาคาร " + (i * 2 + 2), type: types[(i + 1) % 2], owner: p.name });
  });
  buildings.push({ name: "DEMO อาคาร ว่าง", type: "อาคารชุด", owner: "" });

  var KINDS = ["todo", "overdue", "fix", "review", "ontime", "late"];
  var tasks = [];
  for (var i = 0; people.length && i < 30; i++) {
    var pi = i % people.length, p = people[pi];
    var kind = i === 29 ? "cancelled" : KINDS[i % 6];
    var created, due, cur = "", round = "0", state = "on_process", sends = [];
    if (kind === "todo") { created = add(today, -(i % 5)); due = add(today, 5); }
    else if (kind === "overdue") { created = add(today, -(20 + i % 10)); due = add(today, -(3 + i % 5)); }
    else if (kind === "fix") {
      created = add(today, -15); due = add(created, 7); cur = add(today, 4); round = "1";
      sends = [{ sent_on: add(created, 5), due_on: due, outcome: "fix", fix_note: "แก้ไขเอกสารแนบให้ครบถ้วน", next_due_on: cur }];
    } else if (kind === "review") {
      created = add(today, -(3 + i % 10)); due = add(today, 3); state = "submitted";
      sends = [{ sent_on: add(today, -1), due_on: due, outcome: "pending" }];
    } else if (kind === "ontime") {
      created = add(today, -(12 + i % 40)); due = add(created, 7); state = "approved";
      sends = [{ sent_on: add(due, -1), due_on: due, outcome: "approved" }];
    } else if (kind === "late") {
      created = add(today, -(14 + i % 40)); due = add(created, 7); state = "approved";
      sends = [{ sent_on: add(due, 3), due_on: due, outcome: "approved" }];
    } else { created = add(today, -6); due = add(today, 2); state = "cancelled"; }
    tasks.push({
      kind: kind,
      cells: {
        building: buildings[pi * 2 + (i % 2)].name, title: "[DEMO] " + DEMO_TITLES[i % DEMO_TITLES.length],
        details: "ข้อมูลทดสอบ (demo) · ลบได้ด้วย clearDemo", tags: DEMO_TAGS[i % 4] + (i % 3 === 0 ? ", " + DEMO_TAGS[(i + 1) % 4] : ""),
        owner_id: p.line_user_id, owner_name: p.name, state: state, due_on: due, current_due_on: cur, fix_round: round,
        created_by: DEMO, created_at: at9(created), member_notified_at: nowIso,
      },
      sends: sends.map(function (s) {
        return {
          sent_on: s.sent_on, sent_at: at9(s.sent_on), due_on: s.due_on, outcome: s.outcome, fix_note: s.fix_note || "",
          next_due_on: s.next_due_on || "", reviewed_by: s.outcome === "pending" ? "" : DEMO,
          reviewed_at: s.outcome === "pending" ? "" : at9(s.sent_on), member_notified_at: nowIso,
        };
      }),
    });
  }

  var STATUS = ["ตั้งเบิก", "รอวางบิล", "รอโอนเงิน", "รอใบเสร็จ", "เรียบร้อย"];
  var SUBJECTS = ["ค่าส่วนกลาง", "ค่าน้ำประปา", "ค่าทนายความ", "ค่าธรรมเนียมศาล", "ค่าซ่อมบำรุง", "ค่าประกันภัย", "ค่ารักษาความปลอดภัย", "ค่าทำความสะอาด"];
  var invoices = SUBJECTS.map(function (subject, k) {
    var status = STATUS[k % 5], billed = add(today, -(30 - k * 3));
    return {
      building: buildings[k % buildings.length].name, subject: "[DEMO] " + subject, amount: String(1500 + k * 2750.5),
      billed_on: k % 5 >= 2 ? billed : "", transfer_on: k % 5 >= 3 ? add(billed, 7) : "", receipt_on: k % 5 >= 4 ? add(billed, 12) : "",
      status: status, note: k === 0 ? "ข้อมูลทดสอบ (demo)" : "", created_by: DEMO, created_at: at9(add(today, -(31 - k * 3))),
    };
  });

  var news = [
    { title: "[DEMO] ประชุมทีมกฎหมายประจำเดือน", body: "วันศุกร์นี้ 10:00 น. ห้องประชุมใหญ่\n(ข้อมูลทดสอบ)", pinned: "1", created_by: DEMO, created_at: at9(add(today, -2)) },
    { title: "[DEMO] ปิดปรับปรุงระบบ", body: "ระบบจะปิดปรับปรุง 30 นาที หลังเวลาทำการ", pinned: "", created_by: DEMO, created_at: at9(add(today, -1)) },
    { title: "[DEMO] แบบฟอร์มใหม่ใน Example Document", body: "", pinned: "", created_by: DEMO, created_at: at9(add(today, -5)) },
  ];
  return { buildings: buildings, tasks: tasks, invoices: invoices, news: news };
}

/** Adds the demo rows. Stops if demo data is already there (run clearDemo first). */
function seedDemo() {
  var tabs = readTabs(["Tasks", "Members", "Buildings"]);
  if (tabs.Tasks.some(function (r) { return normCell(r.created_by).trim() === DEMO; })) throw new Error("Demo data already exists: run clearDemo first.");
  var members = tabs.Members
    .filter(function (m) { return normCell(m.role).trim() === "member" && normCell(m.name).trim(); })
    .map(function (m) { return { line_user_id: normCell(m.line_user_id).trim(), name: normCell(m.name).trim() }; });
  var today = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
  var plan = demoPlan(today, members, new Date().toISOString());

  var have = tabs.Buildings.map(function (b) { return normCell(b.name).trim(); });
  runBatch([{ op: "append", tab: "Buildings", rows: plan.buildings.filter(function (b) { return have.indexOf(b.name) < 0; }) }]);
  var sendCount = 0;
  if (plan.tasks.length) {
    var made = runBatch([{ op: "append", tab: "Tasks", rows: plan.tasks.map(function (t) { return t.cells; }) }]).results[0];
    var sends = [];
    plan.tasks.forEach(function (t, k) { t.sends.forEach(function (s) { s.task_id = made[k].id; sends.push(s); }); });
    if (sends.length) runBatch([{ op: "append", tab: "Sends", rows: sends }]);
    sendCount = sends.length;
  }
  runBatch([{ op: "append", tab: "Invoices", rows: plan.invoices }]);
  runBatch([{ op: "append", tab: "News", rows: plan.news }]);
  Logger.log("Demo added: %s buildings, %s tasks, %s sends, %s invoices, %s news.",
    plan.buildings.length, plan.tasks.length, sendCount, plan.invoices.length, plan.news.length);
  if (!members.length) Logger.log("No members in the Members tab, so no demo tasks. Open an admin page in the app once (it fills Members), then run clearDemo and seedDemo again.");
}

/** Deletes exactly the demo rows added by seedDemo. Safe to run more than once. */
function clearDemo() {
  var tabs = readTabs(["Tasks", "Buildings"]);
  var taskIds = tabs.Tasks.filter(function (r) { return normCell(r.created_by).trim() === DEMO; }).map(function (r) { return r.id; });
  var demoBuildings = tabs.Buildings.map(function (b) { return normCell(b.name).trim(); }).filter(function (n) { return n.indexOf("DEMO ") === 0; });
  var out = withLock(function () {
    return {
      sends: deleteRows("Sends", "task_id", taskIds),
      tasks: deleteRows("Tasks", "created_by", [DEMO]),
      invoices: deleteRows("Invoices", "created_by", [DEMO]),
      news: deleteRows("News", "created_by", [DEMO]),
      buildings: deleteRows("Buildings", "name", demoBuildings),
    };
  });
  Logger.log("Demo removed: " + JSON.stringify(out));
}

if (typeof module !== "undefined") module.exports = { demoPlan: demoPlan };
