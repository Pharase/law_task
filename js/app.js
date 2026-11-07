// Shared by every page: LINE login, calls to the Supabase `api` function, role gate, uploads.
// Load after the LIFF SDK: <script src="js/app.js"></script> (or ../js/app.js from admin/).
const LIFF_ID = "2012450429-k3WOCwtO";
const API_URL = "https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api";
const HOME = new URL("../", document.currentScript.src).href;

const $ = (id) => document.getElementById(id);

async function api(action, data = {}) {
  const isForm = data instanceof FormData;
  if (isForm) data.append("action", action);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "x-line-id-token": liff.getIDToken() ?? "", ...(isForm ? {} : { "content-type": "application/json" }) },
    body: isForm ? data : JSON.stringify({ action, ...data }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { // ID token expired (~1 h): get a fresh one
    liff.logout();
    liff.login({ redirectUri: location.origin + location.pathname });
    throw new Error("Session expired, logging in again…");
  }
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// Call at the top of every page. Resolves to the profile, or redirects away.
// need: "member" (members and admins), "admin", or "any" (home page: shows invite-code screen itself).
async function start(need = "member") {
  await liff.init({ liffId: LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.origin + location.pathname });
    return new Promise(() => {}); // page is navigating away
  }
  const me = await api("me");
  const ok = need === "any" || (need === "admin" ? me.role === "admin" : me.role === "member" || me.role === "admin");
  if (!ok) {
    location.replace(HOME); // the server enforces roles anyway; this just avoids a dead page
    return new Promise(() => {});
  }
  return me;
}

// Pictures: max 1600 px long side, re-encoded as JPEG until <= 50% of the original (or best effort).
// PDFs and anything the browser can't decode (e.g. HEIC outside Safari) upload unchanged.
async function shrinkImage(file) {
  if (!file.type.startsWith("image/")) return file;
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob;
  for (const q of [0.8, 0.65, 0.5, 0.35]) {
    blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob.size <= file.size * 0.5) break;
  }
  if (blob.size >= file.size) return file; // already tiny; don't make it worse
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

async function uploadFile(file) {
  const form = new FormData();
  form.append("file", await shrinkImage(file));
  return api("upload", form);
}
