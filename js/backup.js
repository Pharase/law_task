// Admin backup banner (spec "Retention"): files over 1 year old are deleted only after an admin downloads them here.
// Needs js/app.js (api). JSZip is loaded from cdnjs only when the admin clicks Download.
const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
const PART_BYTES = 200 * 1024 * 1024; // keep each ZIP small enough for a phone/browser to build in memory

function loadJsZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: JSZIP_URL, onload: () => resolve(window.JSZip), onerror: reject });
    document.head.append(s);
  });
}

const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);

function saveBlob(blob, filename) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
}

async function downloadBackup(files, status) {
  const JSZip = await loadJsZip();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  let zip = new JSZip(), ids = [], bytes = 0, part = 1, done = 0;
  const flush = async () => {
    if (!ids.length) return;
    status.textContent = `กำลังสร้าง ZIP ส่วนที่ ${part}…`;
    saveBlob(await zip.generateAsync({ type: "blob" }), `law_task-backup-${day}-part${part}.zip`);
    await api("backupDone", { ids }); // recorded only after this part's download was triggered
    zip = new JSZip(); ids = []; bytes = 0; part++;
  };
  for (const f of files) {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`ดาวน์โหลด ${f.name} ไม่สำเร็จ (${res.status})`);
    const blob = await res.blob();
    if (bytes && bytes + blob.size > PART_BYTES) await flush();
    zip.file(`${safe(f.owner_name)}/${f.task_id ? "task-" + f.task_id : "no-task"}/${f.id.slice(0, 8)}-${safe(f.name)}`, blob);
    ids.push(f.id); bytes += blob.size; done++;
    status.textContent = `กำลังรวมไฟล์ ${done}/${files.length}…`;
  }
  await flush();
  status.textContent = `สำรองข้อมูลแล้ว ${files.length} ไฟล์ (${part - 1} ZIP)`;
}

async function initBackupBanner() {
  let res;
  try { res = await api("backupList"); } catch { return; } // banner is a nudge; never break the page
  const box = document.createElement("div");
  if (res.quotaLow) {
    const q = Object.assign(document.createElement("p"), { className: "error", textContent: "โควตา LINE เดือนนี้หมดแล้ว: ดูงานในแอปแทน (LINE quota reached, check the app)" });
    box.append(q);
  }
  if (res.files.length) {
    const status = Object.assign(document.createElement("p"), { role: "status" });
    const btn = Object.assign(document.createElement("button"), { type: "button", className: "small", textContent: "ดาวน์โหลดสำรอง (Download backup)" });
    btn.onclick = async () => {
      btn.disabled = true;
      try { await downloadBackup(res.files, status); btn.remove(); }
      catch (e) { status.textContent = "Error: " + e.message; btn.disabled = false; }
    };
    box.append(
      Object.assign(document.createElement("strong"), { textContent: `มี ${res.files.length} ไฟล์อายุเกิน 1 ปีรอสำรองข้อมูล (files waiting for backup)` }),
      Object.assign(document.createElement("p"), { className: "muted", textContent: "ไฟล์จะถูกลบหลังจากดาวน์โหลดสำรองแล้วเท่านั้น" }),
      btn, status);
  }
  if (box.childNodes.length) {
    box.className = "card backup-banner";
    document.querySelector("h1").after(box);
  }
}
