// Pure helpers for the row store (no Google APIs), so node can test them: node --test "gscript/*.test.cjs".
// The app's rules live in the Supabase `api` function; this file only knows tabs, headers and compare-and-set.

var HEADERS = {
  Tasks: ["id", "building", "title", "details", "tags", "owner_id", "owner_name", "state", "due_on", "current_due_on",
    "fix_round", "created_by", "created_at", "member_notified_at"],
  Sends: ["id", "task_id", "sent_on", "sent_at", "due_on", "outcome", "fix_note", "next_due_on", "reviewed_by",
    "reviewed_at", "member_notified_at"],
  Buildings: ["name", "type", "owner"], // type: บ้านจัดสรร or อาคารชุด; owner: the หัวหน้างาน (staff name) who looks after it
  Invoices: ["id", "building", "subject", "amount", "billed_on", "transfer_on", "receipt_on", "status", "note",
    "created_by", "created_at", "updated_at"],
  Members: ["line_user_id", "name", "role"],
};

/** A cell as a string; dates as YYYY-MM-DD in the script's time zone (Asia/Bangkok, see appsscript.json). */
function normCell(v) {
  if (v instanceof Date) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return v.getFullYear() + "-" + p(v.getMonth() + 1) + "-" + p(v.getDate());
  }
  return v === null || v === undefined ? "" : String(v);
}

/** Sheet values (header row first) -> objects keyed by header, with `_row` = sheet row number. Blank rows skipped. */
function toObjects(values) {
  var headers = values[0].map(normCell);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var cells = values[i].map(normCell);
    if (cells.every(function (c) { return c.trim() === ""; })) continue;
    var row = { _row: i + 1 };
    headers.forEach(function (h, j) { if (h) row[h] = cells[j] === undefined ? "" : cells[j]; });
    out.push(row);
  }
  return out;
}

/**
 * Runs append/update steps against a copy of `tables` ({tab: {headers, rows}}). All or nothing:
 * returns {writes, results} only when every step succeeded, else {conflict:true} or {error}.
 * `nextId(tab)` hands out ids (a counter owned by the caller).
 */
function planBatch(steps, tables, nextId) {
  var t = {};
  Object.keys(tables).forEach(function (k) {
    t[k] = { headers: tables[k].headers, rows: tables[k].rows.map(function (r) { return Object.assign({}, r); }) };
  });
  var writes = [], results = [];
  for (var s = 0; s < steps.length; s++) {
    var step = steps[s], tab = t[step.tab];
    if (!tab) return { error: "unknown tab " + step.tab };
    if (step.op === "append") {
      var added = (step.rows || []).map(function (input) {
        var last = tab.rows.reduce(function (m, r) { return Math.max(m, r._row); }, 1);
        var row = { _row: last + 1 };
        tab.headers.forEach(function (h) { row[h] = normCell(input[h]); });
        if (tab.headers.indexOf("id") >= 0) row.id = String(nextId(step.tab));
        tab.rows.push(row);
        writes.push({ tab: step.tab, kind: "append", row: row });
        return row;
      });
      results.push(added);
    } else if (step.op === "update") {
      var key = step.key || "id"; // tabs without ids (Buildings) match on another column
      var found = tab.rows.filter(function (r) { return normCell(r[key]).trim() === String(step.id).trim(); })[0];
      if (!found) return { error: "not found" };
      var expect = step.expect || {};
      // Trimmed like the app reads cells, so a stray space typed by hand can't cause a permanent conflict.
      for (var k in expect) if (normCell(found[k]).trim() !== normCell(expect[k]).trim()) return { conflict: true };
      var cols = Object.keys(step.patch || {}).filter(function (h) { return h !== "id" && tab.headers.indexOf(h) >= 0; });
      cols.forEach(function (h) { found[h] = normCell(step.patch[h]); });
      writes.push({ tab: step.tab, kind: "update", row: found, cols: cols }); // only patched cells are written
      results.push(found);
    } else {
      return { error: "unknown step " + step.op };
    }
  }
  return { writes: writes, results: results };
}

if (typeof module !== "undefined") module.exports = { HEADERS: HEADERS, normCell: normCell, toObjects: toObjects, planBatch: planBatch };
