"use strict";

const $ = (sel) => document.querySelector(sel);
// KI-Inhalte werden als HTML eingesetzt -> immer escapen.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Icons (eigenes Linien-Icon-Set statt Emojis, erbt Farbe via currentColor) ----------
const ICON_PATHS = {
  book: '<path d="M3 5.2c0-.66.54-1.2 1.2-1.2H11a1 1 0 0 1 1 1v14.6a1 1 0 0 1-1.53.85C9.2 19.3 6.9 18.6 4.2 18.6c-.66 0-1.2-.54-1.2-1.2V5.2Z"/><path d="M21 5.2c0-.66-.54-1.2-1.2-1.2H13a1 1 0 0 0-1 1v14.6a1 1 0 0 0 1.53.85c1.27-.75 3.57-1.45 6.27-1.45.66 0 1.2-.54 1.2-1.2V5.2Z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="6.5"/><line x1="16" y1="3" x2="16" y2="6.5"/><circle cx="8" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="1" fill="currentColor" stroke="none"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2.2l1.6 10.2a2 2 0 0 0 2 1.7h8.6a2 2 0 0 0 2-1.6L21 8.5H6.3"/>',
  sparkles: '<path d="M12 3l1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3Z"/><path d="M19 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  warning: '<path d="M12 4.5 21 19H3L12 4.5Z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none"/>',
  utensils: '<path d="M7 3v6a2 2 0 0 0 2 2v10"/><path d="M5 3v5m2-5v5m2-5v5"/><path d="M17 3c-1.5 0-2.5 1.5-2.5 4v4c0 1 .5 1.7 1.3 2L15 21"/>',
  pizza: '<path d="M12 3 3 20h18L12 3Z"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="16" r="1" fill="currentColor" stroke="none"/>',
  noodles: '<path d="M4 12h16a8 8 0 0 1-16 0Z"/><path d="M8 12c0-3 .5-6 1.5-8M16 12c0-3-.5-6-1.5-8"/>',
  sushi: '<rect x="4" y="10" width="16" height="7" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><circle cx="12" cy="7" r="2.3"/>',
  curry: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z"/><path d="M8 11c.3-2 1.3-3.4 2-4M16 11c-.3-2-1.3-3.4-2-4"/><circle cx="12" cy="5.2" r="1" fill="currentColor" stroke="none"/>',
  taco: '<path d="M3 13a9 9 0 0 1 18 0c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1Z"/><path d="M6 13c.5 1.5 1.4 2.5 2.5 3M12 13c.2 1.6.8 2.7 1.7 3.5M17.5 13c-.3 1.4-1 2.4-1.8 3.2"/>',
  olive: '<path d="M4 16c4-6 10-10 16-10-1 6-6 12-13 13"/><circle cx="9" cy="14" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="11.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="9" r="1.3" fill="currentColor" stroke="none"/>',
  croissant: '<path d="M4 15c1-5 5-9 9-9 2 0 3.5 1 4 2-4 .5-7 3-8.5 7-.5 1.3-1.5 2-2.7 1.8C4.5 16.5 3.8 16 4 15Z"/>',
  burger: '<path d="M4 10a8 8 0 0 1 16 0Z"/><line x1="4" y1="13" x2="20" y2="13"/><line x1="4.5" y1="16" x2="19.5" y2="16"/><path d="M4 19h16"/>',
  paella: '<circle cx="11" cy="12" r="7"/><line x1="18" y1="10" x2="22" y2="8"/><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="13" r="1" fill="currentColor" stroke="none"/>',
  bread: '<path d="M4 16c0-4 3.5-8 8-8s8 4 8 8"/><path d="M4 16h16"/><line x1="8" y1="16" x2="8" y2="12.5"/><line x1="12" y1="16" x2="12" y2="11.5"/><line x1="16" y1="16" x2="16" y2="12.5"/>',
  salad: '<path d="M4 13h16a8 8 0 0 1-16 0Z"/><path d="M7 13c0-2 1-4 2.5-5M12 13c0-2.6 1-5 2-6.5M16 13c.3-1.6 1-3 2-4"/>',
  fish: '<path d="M3 12c3-3 7-4 10-4 3 3 5 3 8 1-1 2-1 4 0 6-3-2-5-2-8 1-3 0-7-1-10-4Z"/><circle cx="7.5" cy="11" r=".7" fill="currentColor" stroke="none"/>',
  soup: '<path d="M4 13h16a8 8 0 0 1-16 0Z"/><path d="M8 9c0-1.3.8-1.3.8-2.6M12 9c0-1.3.8-1.3.8-2.6M16 9c0-1.3.8-1.3.8-2.6"/>',
};
function icon(name, cls = "") {
  return `<svg class="ico-svg ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.utensils}</svg>`;
}

document.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = data?.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : `Fehler ${res.status}`);
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

const CUISINE_ICONS = [
  [/ital|pasta|pizza/i, "pizza"], [/asia|chin|thai|viet|korea/i, "noodles"], [/japan|sushi/i, "sushi"],
  [/ind(isch|ian)|curry/i, "curry"], [/mexi|tex/i, "taco"], [/griech|mediterr|türk|orient|arab|levant/i, "olive"],
  [/franz|french/i, "croissant"], [/amerik|burger|usa/i, "burger"], [/span/i, "paella"],
  [/deutsch|german|bayer|österr|schwäb/i, "bread"], [/vegan|veget|salat/i, "salad"], [/fisch|meer/i, "fish"], [/suppe|eintopf/i, "soup"],
];
function iconFor(r) {
  const hay = [r.cuisine, r.title, ...(r.tags || [])].join(" ");
  const match = CUISINE_ICONS.find(([re]) => re.test(hay));
  return icon(match ? match[1] : "utensils");
}

const fmtNum = (n) => (n == null ? "" : Number(n).toLocaleString("de-DE", { maximumFractionDigits: 2 }));
const fmtAmount = (amount, unit) => (amount == null ? (unit ? unit : "nach Bedarf") : `${fmtNum(amount)} ${unit || ""}`.trim());
const totalTime = (r) => (r.prep_time_min || 0) + (r.cook_time_min || 0);

// ---------- Tabs ----------
const TITLES = { recipes: "Rezepte", plan: "Wochenplan", shopping: "Einkaufsliste" };
const LOADERS = { recipes: loadRecipes, plan: loadPlan, shopping: loadShopping };

function showTab(name) {
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === `tab-${name}`));
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $("#title").textContent = TITLES[name];
  location.hash = name;
  window.scrollTo(0, 0);
  LOADERS[name]().catch((e) => toast(e.message));
}
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

// ---------- Rezepte ----------
let recipes = [];

async function loadRecipes() {
  recipes = await api("/api/recipes");
  const grid = $("#recipe-grid");
  if (!recipes.length) {
    grid.innerHTML = `<div class="empty"><div class="big">${icon("utensils")}</div><p>Noch keine Rezepte.<br>Lass dir oben neue Ideen generieren.</p></div>`;
    return;
  }
  grid.innerHTML = recipes.map((r) => `
    <article class="card recipe" data-id="${r.id}" tabindex="0">
      ${r.planned ? `<span class="badge" title="Eingeplant">${icon("check")}</span>` : ""}
      <div class="thumb">${iconFor(r)}</div>
      <div class="body">
        <h3>${esc(r.title)}</h3>
        <div class="meta">${icon("clock", "inline")} ${totalTime(r)} Min · ${r.servings} Port.</div>
        <div class="tags">${r.tags.slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>
    </article>`).join("");
}
$("#recipe-grid").addEventListener("click", (e) => {
  const card = e.target.closest(".recipe");
  if (card) openDetail(Number(card.dataset.id));
});

$("#gen-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector("button");
  const status = $("#gen-status");
  const body = {
    cuisine: f.get("cuisine").trim(),
    servings: Number(f.get("servings")) || 2,
    diet: f.get("diet"),
    max_time_min: f.get("max_time_min") ? Number(f.get("max_time_min")) : null,
    wish: f.get("wish").trim(),
    count: Number(f.get("count")),
  };
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Die KI kocht…`;
  status.className = "hint";
  status.textContent = "Das dauert meist 30–120 Sekunden. Bitte die Seite offen lassen.";
  try {
    const created = await api("/api/recipes/generate", { method: "POST", body });
    status.textContent = `${created.length} neue Rezepte hinzugefügt.`;
    $("#gen").open = false;
    await loadRecipes();
  } catch (err) {
    status.className = "hint error";
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Generieren";
  }
});

// ---------- Detail ----------
async function openDetail(id) {
  const dlg = $("#detail");
  let r, planned;
  try {
    let plan;
    [r, plan] = await Promise.all([api(`/api/recipes/${id}`), api("/api/plan")]);
    planned = plan.items.some((i) => i.recipe.id === id);
  } catch (e) {
    return toast(e.message);
  }
  const render = () => {
    dlg.innerHTML = `
      <div class="sheet-head"><button class="close" aria-label="Schließen">${icon("close")}</button></div>
      <div class="sheet">
        <div class="hero">${iconFor(r)}</div>
        <h2>${esc(r.title)}</h2>
        <p class="meta">${esc(r.cuisine)} · ${icon("clock", "inline")} ${r.prep_time_min} Min Vorbereitung + ${r.cook_time_min} Min Kochen · ${r.servings} Portionen</p>
        <p>${esc(r.description)}</p>
        <div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        <div class="actions">
          <button class="btn plan-toggle ${planned ? "on" : ""}">${planned ? `${icon("check", "inline")} Für diese Woche eingeplant` : "＋ Für diese Woche einplanen"}</button>
        </div>
        <h3>Zutaten</h3>
        <ul class="ingredients">
          ${r.ingredients.map((i) => `<li><span>${esc(i.name)}</span><span>${esc(fmtAmount(i.amount, i.unit))}</span></li>`).join("")}
        </ul>
        <h3>Zubereitung</h3>
        <ol class="steps">${r.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol>
        <div class="actions"><button class="link-danger">Rezept löschen</button></div>
      </div>`;
    dlg.querySelector(".close").onclick = () => dlg.close();
    dlg.querySelector(".plan-toggle").onclick = async () => {
      try {
        if (planned) await api(`/api/plan/${id}`, { method: "DELETE" });
        else await api(`/api/plan/${id}`, { method: "PUT", body: { multiplier: 1 } });
        planned = !planned;
        render();
        loadRecipes();
      } catch (e) { toast(e.message); }
    };
    dlg.querySelector(".link-danger").onclick = async () => {
      if (!confirm(`„${r.title}" wirklich löschen?`)) return;
      try {
        await api(`/api/recipes/${id}`, { method: "DELETE" });
        dlg.close();
        loadRecipes();
      } catch (e) { toast(e.message); }
    };
  };
  render();
  dlg.showModal();
  dlg.scrollTop = 0;
}
// Tippen auf den Hintergrund schließt das Sheet.
$("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") e.target.close(); });
$("#detail").addEventListener("close", () => {
  const tab = location.hash.slice(1);
  if (tab === "plan") loadPlan();
});

// ---------- Wochenplan ----------
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

async function loadPlan() {
  const plan = await api("/api/plan");
  $("#plan-week").textContent = `Woche ab ${fmtDate(plan.week_start)} · ${plan.items.length} Gerichte`;
  const list = $("#plan-list");
  if (!plan.items.length) {
    list.innerHTML = `<div class="empty"><div class="big">${icon("calendar")}</div><p>Noch nichts eingeplant.<br>Öffne ein Rezept und tippe auf „Für diese Woche einplanen".</p></div>`;
    return;
  }
  list.innerHTML = plan.items.map(({ recipe: r, multiplier: m }) => `
    <div class="card plan-item" data-id="${r.id}" data-m="${m}">
      <div class="emoji">${iconFor(r)}</div>
      <div class="info">
        <h3>${esc(r.title)}</h3>
        <div class="meta">${icon("clock", "inline")} ${totalTime(r)} Min · ${fmtNum(r.servings * m)} Portionen</div>
      </div>
      <div class="stepper">
        <button data-d="-0.5" aria-label="Weniger Portionen">−</button>
        <span>×${fmtNum(m)}</span>
        <button data-d="0.5" aria-label="Mehr Portionen">＋</button>
      </div>
    </div>`).join("");
}
$("#plan-list").addEventListener("click", async (e) => {
  const item = e.target.closest(".plan-item");
  if (!item) return;
  const id = Number(item.dataset.id);
  const btn = e.target.closest("button[data-d]");
  if (!btn) {
    if (e.target.closest(".info, .emoji")) openDetail(id);
    return;
  }
  const next = Number(item.dataset.m) + Number(btn.dataset.d);
  try {
    // Unter ×0.5 = aus dem Plan entfernen.
    if (next <= 0) await api(`/api/plan/${id}`, { method: "DELETE" });
    else await api(`/api/plan/${id}`, { method: "PUT", body: { multiplier: next } });
    await loadPlan();
  } catch (err) { toast(err.message); }
});
$("#new-week").addEventListener("click", async () => {
  if (!confirm("Neue Woche starten? Wochenplan und Einkaufsliste werden geleert, die Rezepte bleiben erhalten.")) return;
  try {
    await api("/api/plan/new-week", { method: "POST" });
    toast("Neue Woche gestartet.");
    await loadPlan();
  } catch (e) { toast(e.message); }
});

// ---------- Einkaufsliste ----------
async function loadShopping() {
  const data = await api("/api/shopping-list");
  const count = data.groups.reduce((n, g) => n + g.items.length, 0);
  const done = data.groups.reduce((n, g) => n + g.items.filter((i) => i.checked).length, 0);
  $("#shop-week").textContent = `Woche ab ${fmtDate(data.week_start)} · ${done}/${count} erledigt`;
  const list = $("#shop-list");
  if (!count) {
    list.innerHTML = `<div class="empty"><div class="big">${icon("cart")}</div><p>Die Einkaufsliste ist leer.<br>Plane zuerst Gerichte für die Woche ein.</p></div>`;
    return;
  }
  list.innerHTML = data.groups.map((g) => `
    <div class="card group">
      <h2>${esc(g.category)}</h2>
      ${g.items.map((i) => `
        <label class="item ${i.checked ? "done" : ""}">
          <input type="checkbox" data-key="${esc(i.key)}" ${i.checked ? "checked" : ""}>
          <span class="name">${esc(i.name)}
            <small>${esc(i.recipes.join(", "))}</small>
            ${i.note ? `<small class="warn">${icon("warning", "inline")} ${esc(i.note)}</small>` : ""}
          </span>
          <span class="amount">${esc(i.amount == null ? (i.unquantified ? "nach Bedarf" : "") : fmtAmount(i.amount, i.unit))}${i.amount != null && i.unquantified ? " + n.B." : ""}</span>
        </label>`).join("")}
    </div>`).join("");
}
$("#shop-list").addEventListener("change", async (e) => {
  const cb = e.target;
  if (!cb.dataset.key) return;
  cb.closest(".item").classList.toggle("done", cb.checked);
  try {
    await api("/api/shopping-list/check", { method: "PUT", body: { key: cb.dataset.key, checked: cb.checked } });
    loadShopping();
  } catch (err) {
    cb.checked = !cb.checked;
    cb.closest(".item").classList.toggle("done", cb.checked);
    toast(err.message);
  }
});

// ---------- Start ----------
showTab(TITLES[location.hash.slice(1)] ? location.hash.slice(1) : "recipes");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
