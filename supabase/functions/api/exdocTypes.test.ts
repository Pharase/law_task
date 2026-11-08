import { test } from "node:test";
import assert from "node:assert/strict";
import { fileKind, isExDocPath } from "./exdocTypes.ts";

test("allowed types: PDF, Word, pictures, zip/rar; the browser can preview PDF and pictures only", () => {
  assert.deepEqual(fileKind("แบบฟอร์ม.PDF"), { ext: "pdf", mime: "application/pdf", preview: true });
  assert.deepEqual(fileKind("ใบมอบฉันทะ.docx"), { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", preview: false });
  assert.deepEqual(fileKind("คำขอ อช17.doc"), { ext: "doc", mime: "application/msword", preview: false });
  assert.deepEqual(fileKind("10.1.jpg"), { ext: "jpg", mime: "image/jpeg", preview: true });
  assert.deepEqual(fileKind("a.JPEG"), { ext: "jpg", mime: "image/jpeg", preview: true });
  assert.deepEqual(fileKind("เอกสาร.png"), { ext: "png", mime: "image/png", preview: true });
  assert.deepEqual(fileKind("แบบฟอร์มทั้งหมด.ZIP"), { ext: "zip", mime: "application/zip", preview: false });
  assert.deepEqual(fileKind("เอกสาร.rar"), { ext: "rar", mime: "application/vnd.rar", preview: false });
});

test("anything else is refused", () => {
  for (const n of ["sheet.xlsx", "noext", "virus.exe", ".pdf.exe"]) assert.equal(fileKind(n), null, n);
});

test("storage paths are uuid + an allowed extension", () => {
  assert.ok(isExDocPath("123e4567-e89b-12d3-a456-426614174000.docx"));
  assert.ok(isExDocPath("123e4567-e89b-12d3-a456-426614174000.pdf"));
  assert.ok(isExDocPath("123e4567-e89b-12d3-a456-426614174000.zip"));
  assert.ok(isExDocPath("123e4567-e89b-12d3-a456-426614174000.rar"));
  assert.ok(!isExDocPath("123e4567-e89b-12d3-a456-426614174000.7z"));
  assert.ok(!isExDocPath("../evil.pdf"));
});
