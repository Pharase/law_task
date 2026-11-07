// Run: node --test supabase/functions/api/codes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_CHARS, newCode, normalizeCode } from "./codes.ts";

test("codes are 8 chars from the safe alphabet", () => {
  assert.equal(CODE_CHARS.length, 31);
  for (let i = 0; i < 1000; i++) assert.match(newCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
});

test("codes don't repeat", () => {
  const seen = new Set(Array.from({ length: 1000 }, newCode));
  assert.equal(seen.size, 1000);
});

test("user input is normalized", () => {
  assert.equal(normalizeCode(" k7p2-x9qm "), "K7P2X9QM");
});
