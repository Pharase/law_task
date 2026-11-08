import { test } from "node:test";
import assert from "node:assert/strict";
import { pickProfile } from "./profile.ts";

const claims = { sub: "U1", name: "Old Name", picture: undefined };

test("live LINE profile wins when it is the same user", () =>
  assert.deepEqual(pickProfile(claims, { userId: "U1", displayName: "New Name", pictureUrl: "https://p/1" }),
    { display_name: "New Name", picture_url: "https://p/1" }));

test("profile of a different user is ignored (no spoofing)", () =>
  assert.deepEqual(pickProfile(claims, { userId: "U2", displayName: "Evil", pictureUrl: "https://p/2" }),
    { display_name: "Old Name", picture_url: undefined }));

test("no live profile -> ID token claims", () =>
  assert.deepEqual(pickProfile(claims, null), { display_name: "Old Name", picture_url: undefined }));

test("profile without picture keeps the claim picture", () =>
  assert.deepEqual(pickProfile({ sub: "U1", name: "A", picture: "https://p/c" }, { userId: "U1", displayName: "B" }),
    { display_name: "B", picture_url: "https://p/c" }));
