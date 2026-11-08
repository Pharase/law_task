import { test } from "node:test";
import assert from "node:assert/strict";
import { buildingRows, outsideResponsibility } from "./responsibility.ts";

const rows = [
  { _row: 2, name: " KL2 ", type: "อาคารชุด", owner: "ทีมนุ่น" },
  { _row: 3, name: "SD7", type: "", owner: "ทีมมิน" },
  { _row: 4, name: "The One", type: "", owner: "" },
  { _row: 5, name: "KL2", type: "", owner: "ทีมอื่น" }, // duplicate name: first row wins
  { _row: 6, name: "", type: "", owner: "ทีมบี" },
];

test("buildingRows: trimmed, de-duplicated, blank names dropped, sorted", () =>
  assert.deepEqual(buildingRows(rows), [
    { name: "KL2", type: "อาคารชุด", owner: "ทีมนุ่น" },
    { name: "SD7", type: "", owner: "ทีมมิน" },
    { name: "The One", type: "", owner: "" },
  ]));

const b = buildingRows(rows);
test("a building in the owner's responsibility is fine", () => assert.equal(outsideResponsibility("KL2", ["ทีมนุ่น"], b), null));
test("a building another team looks after is refused, naming the owner", () => assert.equal(outsideResponsibility("SD7", ["ทีมนุ่น"], b), "ทีมนุ่น"));
test("an unassigned building is refused for someone who has buildings", () => assert.equal(outsideResponsibility("The One", ["ทีมนุ่น"], b), "ทีมนุ่น"));
test("someone with no buildings yet is not restricted (before the table is filled)", () => assert.equal(outsideResponsibility("SD7", ["ทีมใหม่"], b), null));
test("several owners: the first one it does not belong to is named", () => assert.equal(outsideResponsibility("KL2", ["ทีมนุ่น", "ทีมมิน"], b), "ทีมมิน"));
