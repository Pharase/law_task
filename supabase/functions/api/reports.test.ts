import { test } from "node:test";
import assert from "node:assert/strict";
import { latestPerKind } from "./reports.ts";

const f = (name: string) => ({ name });

test("newest file of each kind, ชั้นฟ้อง first", () => {
  const files = [f("รายงานชั้นบังคับคดี พ.ย. 69.pdf"), f("รายงานชั้นฟ้อง พ.ย. 69.pdf"), f("รายงานชั้นบังคับคดี ต.ค. 69.pdf"), f("รายงานชั้นฟ้อง ต.ค. 69.pdf")];
  assert.deepEqual(latestPerKind(files).map((x) => x.name), ["รายงานชั้นฟ้อง พ.ย. 69.pdf", "รายงานชั้นบังคับคดี พ.ย. 69.pdf"]);
});

test("a missing kind is skipped; no match at all -> the newest file", () => {
  assert.deepEqual(latestPerKind([f("other.pdf"), f("ชั้นฟ้อง ต.ค.pdf")]).map((x) => x.name), ["ชั้นฟ้อง ต.ค.pdf"]);
  assert.deepEqual(latestPerKind([f("a.pdf"), f("b.pdf")]).map((x) => x.name), ["a.pdf"]);
  assert.deepEqual(latestPerKind([]), []);
});
