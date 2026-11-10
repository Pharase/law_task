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
  ["Button%20E/", "Property Right"],
  ["Button%20F/", "Invoice"],
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
  brand.append(Object.assign(document.createElement("img"), { src: HOME + "img/logo.png", alt: "law_task · Home" }));
  if (!document.querySelector("link[rel=icon]")) {
    document.head.append(Object.assign(document.createElement("link"), { rel: "icon", type: "image/png", href: HOME + "img/logo.png" }));
  }
  const links = Object.assign(document.createElement("div"), { className: "nav-links" });
  links.append(...NAV.map(([path, label, soon, adminPath]) => {
    const a = document.createElement("a");
    a.href = HOME + (navAdmin && adminPath ? adminPath : path);
    a.textContent = label;
    if (a.href === here) a.setAttribute("aria-current", "page");
    if (soon) a.append(Object.assign(document.createElement("small"), { className: "soon", textContent: " soon" }));
    return a;
  }));
  nav.replaceChildren(brand, links, ...(navMe ? [navUser(navMe)] : []));
}
document.addEventListener("DOMContentLoaded", renderNav);

// ---- Loading: a balance scale tipping left, right, ever less, until level (fills every empty .loading; CSS animates it) ----
const SCALE_SVG = `<svg class="scale" viewBox="0 0 120 72" aria-hidden="true">
  <path d="M60 16V66M46 66H74"/>
  <g class="beam"><path d="M22 16H98"/><g class="pan l"><path d="M26 16L15 44M26 16L37 44"/><path class="pan-dish" d="M11 44Q26 57 41 44Z"/></g><g class="pan r"><path d="M94 16L83 44M94 16L105 44"/><path class="pan-dish" d="M79 44Q94 57 109 44Z"/></g></g>
  <circle class="pivot" cx="60" cy="16" r="3.5"/>
</svg>`;
function fillLoaders() {
  for (const box of document.querySelectorAll(".loading:empty")) {
    box.setAttribute("aria-label", "Loading");
    box.innerHTML = SCALE_SVG; // constant markup, no user data
  }
}
document.addEventListener("DOMContentLoaded", fillLoaders);
// credit line at the bottom of every page
document.addEventListener("DOMContentLoaded", () => document.body.append(Object.assign(document.createElement("footer"), { className: "site-foot", textContent: `© ${new Date().getFullYear()} law_task · Powered by Pharase` })));

// ---- Right side of the navbar: (admins) members link with waiting count, who you are, Log out ----
const ROLE_TEXT = { pending: "Pending approval", member: "Member", admin: "Admin", revoked: "Access revoked" };
let navMe = null, pendingCount = null; // pendingCount: the admin's listUsers call, made once per page

/** Show this person in the navbar (called by start(); Home calls it again after an invite code is redeemed). */
function setNavUser(me) {
  navMe = me;
  navAdmin = me.role === "admin";
  renderNav();
}

function navUser(me) {
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const box = el("div", { className: "nav-user" });
  if (me.role === "admin") {
    // 🔗 = Members & invite codes; the red dot counts people who logged in and wait for an invite code.
    const dot = el("span", { className: "nav-dot", hidden: true });
    const link = el("a", { className: "nav-icon", href: HOME + "admin/members.html", title: "สมาชิกและรหัสเชิญ · Members & invite codes", ariaLabel: "Members & invite codes" },
      el("span", { ariaHidden: "true", textContent: "🔗" }), dot);
    pendingCount ??= api("listUsers").then((users) => ({
      pending: users.filter((u) => u.role === "pending").length,
      connected: users.filter((u) => u.role === "member" || u.role === "admin").length,
    }));
    pendingCount.then(({ pending, connected }) => {
      dot.hidden = !pending;
      dot.textContent = pending > 99 ? "99+" : pending;
      link.title = `ผู้ใช้ที่เชื่อมต่อ ${connected} · รออนุมัติ ${pending} — Members & invite codes`;
      link.ariaLabel = `Members & invite codes: ${connected} connected, ${pending} waiting for approval`;
    }).catch(() => {});
    box.append(link);
  }
  const avatar = me.picture_url
    ? el("img", { className: "nav-avatar", src: me.picture_url, alt: "" })
    : el("span", { className: "nav-avatar nav-initial", textContent: (me.staff_name || me.display_name || "?").trim().charAt(0) });
  const who = el("div", { className: "nav-who" },
    el("strong", { textContent: me.staff_name || me.display_name || "-" }),
    el("span", { className: "badge " + (me.role === "member" || me.role === "admin" ? "on" : "off"), textContent: ROLE_TEXT[me.role] ?? me.role }));
  const out = el("button", { type: "button", className: "small secondary nav-logout", title: "Log out", ariaLabel: "Log out" },
    el("span", { className: "nav-logout-text", textContent: "Log out" }));
  // power icon drawn as SVG: the ⏻ character is missing from most fonts (constant markup, no user data)
  out.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>');
  out.onclick = () => {
    liff.logout();
    if (liff.isInClient()) liff.closeWindow(); // inside LINE there is no login page to go back to
    else location.replace(HOME);
  };
  box.append(el("div", { className: "nav-me", title: "LINE: " + (me.display_name ?? "-") }, avatar, who), out);
  return box;
}
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
  setNavUser(me);
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

// ---- Dates: every <input type="date"> becomes a dd/mm/yyyy (Buddhist year) text box with a mini calendar ----
// The original input stays (hidden) and keeps the ISO value, so code reading .value / .min / .required is unchanged.
const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_WEEK = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"]; // Monday first
const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

/** "2026-11-08" -> "08/11/2569" ("" when not a date). */
function dateText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : "";
}

/** "8/11/2569" or "08/11/2026" -> "2026-11-08"; null when it isn't a real date. Years above 2400 are Buddhist. */
function parseDateText(t) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(t).trim());
  if (!m) return null;
  const y = Number(m[3]) > 2400 ? Number(m[3]) - 543 : Number(m[3]);
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[1]) ? d.toISOString().slice(0, 10) : null;
}

let openPop = null;
// The open calendar pops out below its card; lift that card so the next card cannot cover it.
function closeCalendar() { openPop?.closest(".card")?.classList.remove("dp-open"); openPop?.remove(); openPop = null; }
document.addEventListener("pointerdown", (e) => { if (openPop && !e.target.closest(".dp")) closeCalendar(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCalendar(); });

function enhanceDate(orig) {
  if (orig.dataset.dp) return;
  orig.dataset.dp = "1";
  const valueProp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const raw = () => valueProp.get.call(orig);
  const wrap = Object.assign(document.createElement("span"), { className: "dp" });
  const text = Object.assign(document.createElement("input"), { type: "text", inputMode: "numeric", autocomplete: "off", placeholder: "วว/ดด/ปปปป", className: "dp-text" });
  text.required = orig.required;
  orig.removeAttribute("required");
  // labels pointing at the hidden input now point at the visible box
  if (orig.id) {
    text.id = orig.id + "Text";
    document.querySelectorAll(`label[for="${orig.id}"]`).forEach((l) => { l.htmlFor = text.id; });
  }
  text.setAttribute("aria-label", orig.getAttribute("aria-label") || "วันที่ (วว/ดด/ปปปป)");
  const btn = Object.assign(document.createElement("button"), { type: "button", className: "dp-btn", title: "เลือกวันที่" });
  btn.setAttribute("aria-label", "เลือกวันที่ · Pick a date");
  // constant markup, no user data
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
  orig.classList.add("dp-native");
  orig.tabIndex = -1;
  orig.setAttribute("aria-hidden", "true");
  orig.after(wrap);
  wrap.append(orig, text, btn);

  const check = () => {
    const t = text.value.trim(), iso = t && parseDateText(t);
    text.setCustomValidity(!t ? "" : !iso ? "ใช้รูปแบบ วว/ดด/ปปปป เช่น 08/11/2569"
      : orig.min && iso < orig.min ? "วันที่ต้องไม่ก่อน " + dateText(orig.min)
      : orig.max && iso > orig.max ? "วันที่ต้องไม่หลัง " + dateText(orig.max) : "");
  };
  const set = (iso) => {
    valueProp.set.call(orig, iso);
    orig.dispatchEvent(new Event("input", { bubbles: true }));
    orig.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // code that sets .value / .required on the original keeps working
  Object.defineProperty(orig, "value", { get: raw, set(v) { valueProp.set.call(orig, v); text.value = dateText(raw()); check(); } });
  Object.defineProperty(orig, "required", { get: () => text.required, set(v) { text.required = !!v; } });
  text.value = dateText(raw());
  text.addEventListener("input", () => { check(); set(parseDateText(text.value) || ""); }); // half-typed or impossible = no value
  text.addEventListener("blur", () => { if (parseDateText(text.value)) text.value = dateText(raw()); });
  orig.form?.addEventListener("reset", () => setTimeout(() => { text.value = dateText(raw()); check(); }));
  btn.onclick = () => (openPop && wrap.contains(openPop) ? closeCalendar()
    : showCalendar(wrap, orig, (iso) => { text.value = dateText(iso); check(); set(iso); text.focus(); }));
}

function showCalendar(wrap, orig, pick) {
  closeCalendar();
  const start = orig.value || todayIso();
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)) - 1;
  const pop = Object.assign(document.createElement("div"), { className: "dp-pop" });
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "ปฏิทิน · Calendar");
  const allowed = (iso) => !(orig.min && iso < orig.min) && !(orig.max && iso > orig.max);
  const b = (text, cls, onclick, label) => {
    const x = Object.assign(document.createElement("button"), { type: "button", className: cls, textContent: text });
    if (label) x.setAttribute("aria-label", label);
    x.onclick = onclick;
    return x;
  };
  const render = () => {
    const first = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday = 0
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const head = Object.assign(document.createElement("div"), { className: "dp-head" });
    head.append(
      b("‹", "dp-nav", () => { if (m === 0) { m = 11; y--; } else m--; render(); }, "เดือนก่อน"),
      Object.assign(document.createElement("strong"), { textContent: `${TH_MONTHS[m]} ${y + 543}` }),
      b("›", "dp-nav", () => { if (m === 11) { m = 0; y++; } else m++; render(); }, "เดือนถัดไป"));
    const grid = Object.assign(document.createElement("div"), { className: "dp-grid" });
    grid.append(...TH_WEEK.map((d) => Object.assign(document.createElement("span"), { className: "dp-dow", textContent: d })));
    for (let i = 0; i < first; i++) grid.append(document.createElement("span"));
    for (let d = 1; d <= days; d++) {
      const iso = isoOf(y, m, d);
      const cell = b(String(d), "dp-day" + (iso === todayIso() ? " today" : "") + (iso === orig.value ? " selected" : ""),
        () => { pick(iso); closeCalendar(); }, dateText(iso));
      cell.disabled = !allowed(iso);
      grid.append(cell);
    }
    const foot = Object.assign(document.createElement("div"), { className: "dp-foot" });
    const today = b("วันนี้", "dp-link", () => { pick(todayIso()); closeCalendar(); });
    today.disabled = !allowed(todayIso());
    foot.append(today, b("ล้าง", "dp-link", () => { pick(""); closeCalendar(); }));
    pop.replaceChildren(head, grid, foot);
  };
  render();
  wrap.append(pop);
  wrap.closest(".card")?.classList.add("dp-open");
  openPop = pop;
}

function enhanceDates(root = document) {
  root.querySelectorAll?.('input[type="date"]').forEach(enhanceDate);
}
document.addEventListener("DOMContentLoaded", () => {
  enhanceDates();
  // date boxes created later (review / edit forms) are enhanced as soon as they appear
  new MutationObserver((list) => {
    for (const r of list) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches('input[type="date"]')) enhanceDate(n); else enhanceDates(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
});

/**
 * Open a file link in a way the LINE app can handle. Inside LINE: a preview opens in LINE's browser, a download in
 * the phone's own browser (LINE's browser often cannot save files). Elsewhere: preview in a new tab, download here.
 */
function openFile(url, download = false) {
  if (window.liff?.isInClient?.()) return liff.openWindow({ url, external: download });
  if (download) location.href = url; // served as an attachment: the page stays
  else window.open(url, "_blank", "noopener");
}
