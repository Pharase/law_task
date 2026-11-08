// Shared by every page: LINE login, calls to the Supabase `api` function, role gate, uploads.
// Load after the LIFF SDK: <script src="js/app.js"></script> (or ../js/app.js from admin/).
const LIFF_ID = "2012450429-k3WOCwtO";
const API_URL = "https://edymfgeecbsmepdveqkj.supabase.co/functions/v1/api";
const HOME = new URL("../", document.currentScript.src).href;

const $ = (id) => document.getElementById(id);

// Top navbar on every page: one button per feature, same order as the LINE rich menu.
// [member page, label, coming soon, admin page]: admins get the admin page of the same feature.
const NAV = [
  ["", "Home"], // everyone starts on the Home dashboard; admins reach tracking from there
  ["Button%20C/", "Example Document", false, "admin/exdoc.html"],
  ["Button%20D/", "Reports"],
  ["Button%20E/", "Property Right", true],
  ["Button%20F/", "Invoice", true],
];
let navAdmin = false;
const pageUrl = () => location.href.split(/[?#]/)[0].replace(/index\.html$/, "");

/** An admin who opens a member page (e.g. from the rich menu) is sent to that feature's admin page. */
function adminRedirect() {
  const item = NAV.find(([path, , , adminPath]) => adminPath && new URL(path, HOME).href === pageUrl());
  if (!item) return false;
  location.replace(new URL(item[3], HOME).href);
  return true;
}
function renderNav() {
  if (!document.body) return;
  let nav = $("navbar");
  if (!nav) {
    nav = document.createElement("nav");
    nav.id = "navbar";
    nav.className = "navbar";
    nav.setAttribute("aria-label", "Main menu");
    document.body.prepend(nav);
  }
  const here = pageUrl();
  // Logo (Lady Justice) leads the bar and goes Home; it also becomes the tab icon.
  const brand = Object.assign(document.createElement("a"), { className: "brand", href: HOME });
  brand.append(Object.assign(document.createElement("img"), { src: HOME + "img/logo.svg", alt: "law_task · Home" }));
  if (!document.querySelector("link[rel=icon]")) {
    document.head.append(Object.assign(document.createElement("link"), { rel: "icon", type: "image/svg+xml", href: HOME + "img/logo.svg" }));
  }
  nav.replaceChildren(brand, ...NAV.map(([path, label, soon, adminPath]) => {
    const a = document.createElement("a");
    a.href = HOME + (navAdmin && adminPath ? adminPath : path);
    a.textContent = label;
    if (a.href === here) a.setAttribute("aria-current", "page");
    if (soon) a.append(Object.assign(document.createElement("small"), { className: "soon", textContent: " soon" }));
    return a;
  }));
}
document.addEventListener("DOMContentLoaded", renderNav);
const login = () => liff.login({ redirectUri: location.origin + location.pathname });

async function api(action, data = {}) {
  const isForm = data instanceof FormData;
  if (isForm) data.append("action", action);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-line-id-token": liff.getIDToken() ?? "",
      "x-line-access-token": liff.getAccessToken?.() ?? "", // lets the server read the live LINE name + picture
      ...(isForm ? {} : { "content-type": "application/json" }),
    },
    body: isForm ? data : JSON.stringify({ action, ...data }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Token expired (~1 h): log in again, but only once, so a server misconfig shows an error instead of a redirect loop.
    if (!liff.isInClient() && !sessionStorage.getItem("relogin")) {
      sessionStorage.setItem("relogin", "1");
      liff.logout();
      login();
      return new Promise(() => {}); // page is navigating away
    }
    throw new Error(`Login check failed (${body.error || "401"}). Close and reopen the app; if it keeps happening, tell an admin.`);
  }
  sessionStorage.removeItem("relogin");
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// Call at the top of every page. Resolves to the profile, or redirects away.
// need: "member" (members and admins), "admin", or "any" (home page: resolves null when
// logged out instead of redirecting, and shows the invite-code screen itself).
async function start(need = "member") {
  await liff.init({ liffId: LIFF_ID });
  if (!liff.isLoggedIn()) {
    if (need === "any") return null;
    login();
    return new Promise(() => {});
  }
  const me = await api("me");
  navAdmin = me.role === "admin";
  if (navAdmin && adminRedirect()) return new Promise(() => {}); // page is navigating away
  renderNav();
  const ok = need === "any" || (need === "admin" ? me.role === "admin" : me.role === "member" || me.role === "admin");
  if (!ok) {
    location.replace(HOME); // the server enforces roles anyway; this just avoids a dead page
    return new Promise(() => {});
  }
  return me;
}

// Pictures: max 1600 px long side, re-encoded as JPEG until <= 50% of the original (or best effort).
// PDFs and anything the browser can't decode (e.g. HEIC outside Safari) upload unchanged; the server rejects HEIC.
async function shrinkImage(file) {
  if (!file.type.startsWith("image/")) return file;
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // JPEG has no transparency; without this, transparent areas turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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
