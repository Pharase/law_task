// law_task row store: a web app the Supabase `api` function calls with a shared secret.
// It knows tabs and columns only; every business rule lives in `api` (see docs/superpowers/specs/2026-11-08-gsheet-storage-design.md).
// Script Properties: API_SECRET (required), SHEET_ID (only if this script is not bound to the spreadsheet).

var PROPS = PropertiesService.getScriptProperties();
var STATES = ["on_process", "submitted", "approved", "cancelled"];
var BUILDING_TYPES = ["บ้านจัดสรร", "อาคารชุด"];
var INVOICE_STATUS = ["ตั้งเบิก", "รอวางบิล", "รอโอนเงิน", "รอใบเสร็จ", "เรียบร้อย"];
var DATE_COLS = {
  Tasks: ["due_on", "current_due_on", "created_at", "member_notified_at"],
  Sends: ["sent_on", "sent_at", "due_on", "next_due_on", "reviewed_at", "member_notified_at"],
  Invoices: ["billed_on", "transfer_on", "receipt_on", "created_at", "updated_at"],
  News: ["created_at", "deleted_at"],
};
var APP_COLS = ["id", "owner_id", "state", "current_due_on", "fix_round", "created_by", "created_at", "member_notified_at"];

function book() {
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(PROPS.getProperty("SHEET_ID"));
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PROPS.getProperty("API_SECRET");
    if (!secret || body.secret !== secret) {
      out = { error: "forbidden" };
    } else {
      out = dispatch(body);
    }
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch(body) {
  switch (body.op) {
    case "read": return { tabs: readTabs(body.tabs || []) };
    case "append": return single(runBatch([{ op: "append", tab: body.tab, rows: body.rows }]), "rows");
    case "update": return single(runBatch([{ op: "update", tab: body.tab, id: body.id, patch: body.patch, expect: body.expect }]), "row");
    case "batch": return runBatch(body.steps || []);
    case "setup": setup(); return { ok: true };
    case "replaceMembers": return withLock(function () { replaceMembers(body.rows || []); return { ok: true }; });
    case "listReports": return { files: listReports() };
    case "reportFile": return reportFile(String(body.id || ""));
  }
  return { error: "unknown op" };
}

function single(r, key) {
  if (!r.results) return r;
  var out = {};
  out[key] = r.results[0];
  return out;
}

function readTabs(names) {
  var out = {};
  names.forEach(function (name) {
    var sh = book().getSheetByName(name);
    out[name] = sh && sh.getLastRow() > 0 ? toObjects(sh.getDataRange().getValues()) : [];
  });
  return out;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000); // throws -> {error}, the caller shows "try again"; well under the caller's 10 s timeout
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush(); // writes are buffered: commit them BEFORE the next caller can read, or two sends could both win
    lock.releaseLock();
  }
}

/** All steps under one lock, written only if every step's `expect` still holds. */
function runBatch(steps) {
  return withLock(function () {
    var tables = {};
    steps.forEach(function (s) {
      if (tables[s.tab]) return;
      var sh = book().getSheetByName(s.tab);
      if (!sh || sh.getLastRow() < 1) throw new Error("tab " + s.tab + " is missing; run setup");
      var values = sh.getDataRange().getValues();
      tables[s.tab] = { sheet: sh, headers: values[0].map(normCell), rows: toObjects(values) };
    });
    var plan = planBatch(steps, tables, function (tab) { return nextId(tab, tables[tab].rows); });
    if (!plan.writes) return plan;
    // A tab has a fixed number of rows (1000 when new); grow it first, so no write half-fails past the end.
    Object.keys(tables).forEach(function (tab) {
      var sh = tables[tab].sheet;
      var last = plan.writes.reduce(function (m, w) { return w.tab === tab ? Math.max(m, w.row._row) : m; }, 0);
      if (last > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), last - sh.getMaxRows() + 100);
    });
    plan.writes.forEach(function (w) {
      var t = tables[w.tab];
      var cols = w.kind === "append" ? t.headers.filter(String) : w.cols;
      cols.forEach(function (h) {
        // Plain text: otherwise Sheets turns "1/2" into a date, "007" into 7, "=..." or "- ..." into a formula.
        t.sheet.getRange(w.row._row, t.headers.indexOf(h) + 1).setNumberFormat("@").setValue(w.row[h]);
      });
    });
    return { results: plan.results };
  });
}

/** Per-tab counter, so a deleted row's id (and its attachments) is never reused. Starts after the largest id. */
function nextId(tab, rows) {
  var key = "next_id_" + tab;
  var n = Number(PROPS.getProperty(key));
  if (!n) n = rows.reduce(function (m, r) { return Math.max(m, Number(r.id) || 0); }, 0) + 1;
  PROPS.setProperty(key, String(n + 1));
  return n;
}

function replaceMembers(rows) {
  var sh = book().getSheetByName("Members");
  if (!sh) throw new Error("tab Members is missing; run setup");
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, HEADERS.Members.length)
      .setValues(rows.map(function (r) { return HEADERS.Members.map(function (h) { return normCell(r[h]); }); }));
  }
}

/** Creates missing tabs, headers, dropdowns and warning-only protection. Safe to run again. Run once from the editor. */
function setup() {
  var ss = book();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight("bold");
    // a newer version added columns (e.g. Buildings.type): append the missing headers, existing data stays put
    var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(normCell);
    HEADERS[name].filter(function (h) { return have.indexOf(h) < 0; }).forEach(function (h) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight("bold");
    });
    sh.setFrozenRows(1);
    (DATE_COLS[name] || []).forEach(function (h) { column(sh, h).setNumberFormat("@"); }); // typed dates stay YYYY-MM-DD text
  });
  var tasks = ss.getSheetByName("Tasks");
  var list = function (range) { return SpreadsheetApp.newDataValidation().requireValueInRange(range, true).setAllowInvalid(false).build(); };
  var pick = function (values) { return SpreadsheetApp.newDataValidation().requireValueInList(values, true).build(); };
  var buildingNames = ss.getSheetByName("Buildings").getRange("A2:A");
  column(tasks, "building").setDataValidation(list(buildingNames));
  column(tasks, "owner_name").setDataValidation(list(ss.getSheetByName("Members").getRange("B2:B")));
  column(tasks, "state").setDataValidation(pick(STATES));
  column(ss.getSheetByName("Buildings"), "type").setDataValidation(pick(BUILDING_TYPES));
  column(ss.getSheetByName("Buildings"), "owner").setDataValidation(list(ss.getSheetByName("Members").getRange("B2:B")));
  var invoices = ss.getSheetByName("Invoices");
  column(invoices, "building").setDataValidation(list(buildingNames));
  column(invoices, "status").setDataValidation(pick(INVOICE_STATUS));

  ss.getProtections(SpreadsheetApp.ProtectionType.RANGE).concat(ss.getProtections(SpreadsheetApp.ProtectionType.SHEET))
    .forEach(function (p) { if (p.getDescription() === "law_task") p.remove(); });
  var warn = function (p) { p.setDescription("law_task").setWarningOnly(true); };
  APP_COLS.forEach(function (h) { warn(column(tasks, h).protect()); });
  warn(ss.getSheetByName("Sends").protect());
  warn(ss.getSheetByName("Members").protect());
}

function column(sh, header) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(normCell);
  var i = headers.indexOf(header);
  if (i < 0) throw new Error(sh.getName() + " has no column " + header);
  return sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1);
}

/** Run from the editor after setup: exercises append, update with expect, and conflict on a scratch tab. */
function selfTest() {
  var ss = book();
  var sh = ss.insertSheet("_selftest");
  try {
    sh.getRange(1, 1, 1, 2).setValues([["id", "state"]]);
    var a = runBatch([{ op: "append", tab: "_selftest", rows: [{ state: "on_process" }, { state: "on_process" }] }]);
    var id = a.results[0][0].id;
    var ok = runBatch([{ op: "update", tab: "_selftest", id: id, patch: { state: "submitted" }, expect: { state: "on_process" } }]);
    var clash = runBatch([{ op: "update", tab: "_selftest", id: id, patch: { state: "submitted" }, expect: { state: "on_process" } }]);
    Logger.log(JSON.stringify({ a: a, ok: ok, clash: clash }));
    if (a.results[0].length !== 2 || ok.results[0].state !== "submitted" || !clash.conflict) throw new Error("selfTest failed");
    Logger.log("selfTest passed");
  } finally {
    ss.deleteSheet(sh);
    PROPS.deleteProperty("next_id__selftest");
  }
}

// ---- Monthly reports: files in the Drive folder REPORT_FOLDER_ID (Script Property) ----
// PDFs and Google Docs/Sheets/Slides only; Google files are exported to PDF, so the app always gets the latest version.
var REPORT_TYPES = [MimeType.PDF, MimeType.GOOGLE_DOCS, MimeType.GOOGLE_SHEETS, MimeType.GOOGLE_SLIDES];

function reportFolder() {
  var id = PROPS.getProperty("REPORT_FOLDER_ID");
  if (!id) throw new Error("REPORT_FOLDER_ID is not set");
  return DriveApp.getFolderById(id);
}

function listReports() {
  var files = reportFolder().getFiles(), out = [];
  while (files.hasNext()) {
    var f = files.next();
    if (f.isTrashed() || REPORT_TYPES.indexOf(f.getMimeType()) < 0) continue;
    out.push({ id: f.getId(), name: f.getName(), modified: f.getLastUpdated().toISOString() });
  }
  return out;
}

function reportFile(id) {
  var f = DriveApp.getFileById(id), folderId = reportFolder().getId(), inFolder = false, parents = f.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
  if (!inFolder || REPORT_TYPES.indexOf(f.getMimeType()) < 0) throw new Error("not a report"); // only files from the report folder
  var blob = f.getMimeType() === MimeType.PDF ? f.getBlob() : f.getAs(MimeType.PDF);
  return { name: f.getName().replace(/\.pdf$/i, "") + ".pdf", modified: f.getLastUpdated().toISOString(), base64: Utilities.base64Encode(blob.getBytes()) };
}

/** Run once from the editor after setting REPORT_FOLDER_ID: grants Drive access and logs what the app will list. */
function checkReports() {
  Logger.log(JSON.stringify(listReports(), null, 1));
}
