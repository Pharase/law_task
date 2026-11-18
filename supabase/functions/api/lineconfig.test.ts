import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIFF_ID, masked, maskedUrl, normalizeLine, normalizeSheetLink, resolveLine } from "./lineconfig.ts";

const TOKEN = "x".repeat(150), SECRET = "0123456789abcdef0123456789abcdef";

test("resolveLine: nothing saved = Supabase secrets + built-in LIFF", () => {
  const c = resolveLine(null, { token: "envT", secret: "envS", channelId: "2012450429" });
  assert.deepEqual(c, { token: "envT", secret: "envS", liffId: DEFAULT_LIFF_ID, liffUrl: `https://liff.line.me/${DEFAULT_LIFF_ID}`, channelIds: ["2012450429"] });
  assert.equal(resolveLine({}, {}).token, null);
});

test("resolveLine: saved values win, the built-in channel is still accepted", () => {
  const c = resolveLine({ token: "t", secret: "s", liffId: "1111111111-abcd" }, { token: "envT", channelId: "2012450429" });
  assert.equal(c.token, "t");
  assert.equal(c.liffUrl, "https://liff.line.me/1111111111-abcd");
  assert.deepEqual(c.channelIds, ["1111111111", "2012450429"]);
  assert.equal(resolveLine({ liffId: "garbage" }, {}).liffId, DEFAULT_LIFF_ID); // a bad stored row never breaks login
});

test("normalizeLine: blank keeps, bad input throws", () => {
  const base = { token: TOKEN, secret: SECRET, liffId: DEFAULT_LIFF_ID };
  assert.deepEqual(normalizeLine({ token: "", secret: "  ", liffId: undefined }, base), base);
  assert.equal(normalizeLine({ liffId: " 1111111111-abcd " }, base).liffId, "1111111111-abcd");
  assert.throws(() => normalizeLine({ liffId: "abc" }, base), /LIFF ID/);
  assert.throws(() => normalizeLine({ secret: "zz" }, base), /secret/);
  assert.throws(() => normalizeLine({ token: "short" }, base), /token/);
});

test("masked: last 4 only", () => {
  assert.equal(masked(SECRET), "••••cdef");
  assert.equal(masked(null), null);
});

test("normalizeSheetLink: script /exec URL + secret of 16+ characters; blank keeps the saved value", () => {
  const url = "https://script.google.com/macros/s/AKfycbx1234567890abcdefghijXYZ/exec";
  assert.deepEqual(normalizeSheetLink({ url, secret: "0123456789abcdef" }), { url, secret: "0123456789abcdef" });
  assert.deepEqual(normalizeSheetLink({ url: " ", secret: "" }, { url, secret: "s".repeat(20) }), { url, secret: "s".repeat(20) });
  assert.throws(() => normalizeSheetLink({ url: "https://example.com/exec" }), /script\.google\.com/);
  assert.throws(() => normalizeSheetLink({ url: url.replace("/exec", "/dev") }), /script\.google\.com/);
  assert.throws(() => normalizeSheetLink({ secret: "short" }), /16/);
  assert.equal(maskedUrl(url), "https://script.google.com/macros/s/AKfy••••jXYZ/exec");
});
