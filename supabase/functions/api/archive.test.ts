import { test } from "node:test";
import assert from "node:assert/strict";
import { driveName } from "./driveName.ts";

test("driveName: date, task number, building, title, file; Drive-unsafe characters dropped", () => {
  assert.equal(driveName("2026-11-10", { id: 12, building: "อาคาร A", title: "สรุป/คดี: 1" }, "scan.pdf"),
    "2026-11-10 งาน#12 อาคาร A - สรุป คดี 1 - scan.pdf");
  assert.equal(driveName("2026-11-10", undefined, "a.jpg"), "2026-11-10 (ไม่ได้แนบงาน) a.jpg");
});
