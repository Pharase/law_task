import { test } from "node:test";
import assert from "node:assert/strict";
import { driveName, taskFolderName } from "./driveName.ts";

test("driveName: date, task number, building, title, file; Drive-unsafe characters dropped", () => {
  assert.equal(driveName("2026-11-10", { id: 12, building: "อาคาร A", title: "สรุป/คดี: 1" }, "scan.pdf"),
    "2026-11-10 งาน#12 อาคาร A - สรุป คดี 1 - scan.pdf");
  assert.equal(driveName("2026-11-10", undefined, "a.jpg"), "2026-11-10 (ไม่ได้แนบงาน) a.jpg");
});

test("taskFolderName: id-assigned date (Bangkok)-title-member-building, Drive-unsafe characters dropped", () => {
  const t = { id: 12, created_at: "2026-11-16T18:30:00Z", title: "สรุป/คดี: 1", owner_name: "สมชาย", building: "อาคาร A" };
  assert.equal(taskFolderName(t), "12-2026-11-17-สรุป คดี 1-สมชาย-อาคาร A");
  assert.equal(taskFolderName({ ...t, created_at: "2026-11-01" }), "12-2026-11-01-สรุป คดี 1-สมชาย-อาคาร A");
});
