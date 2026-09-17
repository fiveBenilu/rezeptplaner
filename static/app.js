"use strict";

const $ = (sel) => document.querySelector(sel);
// KI-Inhalte werden als HTML eingesetzt -> immer escapen.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

const EMOJIS = [
  [/ital|pasta|pizza/i, "🍝"], [/asia|chin|thai|viet|korea/i, "🥢"], [/japan|sushi/i, "🍣"],
  [/ind(isch|ian)|curry/i, "🍛"], [/mexi|tex/i, "🌮"], [/griech|mediterr|türk|orient|arab|levant/i, "🫒"],
  [/franz|french/i, "🥐"], [/amerik|burger|usa/i, "🍔"], [/span/i, "🥘"],
  [/deutsch|german|bayer|österr|schwäb/i, "🥨"], [/vegan|veget|salat/i, "🥗"], [/fisch|meer/i, "🐟"], [/suppe|eintopf/i, "🍲"],
];
function emojiFor(r) {
  const hay = [r.cuisine, r.title, ...(r.tags || [])].join(" ");
  return (EMOJIS.find(([re]) => re.test(hay)) || [, "🍽️"])[1];
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
    grid.innerHTML = `<div class="empty"><div class="big">🧑‍🍳</div><p>Noch keine Rezepte.<br>Lass dir oben neue Ideen generieren.</p></div>`;
    return;
  }
  grid.innerHTML = recipes.map((r) => `
    <article class="card recipe" data-id="${r.id}" tabindex="0">
      ${r.planned ? `<span class="badge" title="Eingeplant">✓</span>` : ""}
      <div class="thumb">${emojiFor(r)}</div>
      <div class="body">
        <h3>${esc(r.title)}</h3>
        <div class="meta">⏱ ${totalTime(r)} Min · ${r.servings} Port.</div>
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
      <div class="sheet-head"><button class="close" aria-label="Schließen">✕</button></div>
      <div class="sheet">
        <div class="hero">${emojiFor(r)}</div>
        <h2>${esc(r.title)}</h2>
        <p class="meta">${esc(r.cuisine)} · ⏱ ${r.prep_time_min} Min Vorbereitung + ${r.cook_time_min} Min Kochen · ${r.servings} Portionen</p>
        <p>${esc(r.description)}</p>
        <div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        <div class="actions">
          <button class="btn plan-toggle ${planned ? "on" : ""}">${planned ? "✓ Für diese Woche eingeplant" : "＋ Für diese Woche einplanen"}</button>
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
    list.innerHTML = `<div class="empty"><div class="big">🗓️</div><p>Noch nichts eingeplant.<br>Öffne ein Rezept und tippe auf „Für diese Woche einplanen".</p></div>`;
    return;
  }
  list.innerHTML = plan.items.map(({ recipe: r, multiplier: m }) => `
    <div class="card plan-item" data-id="${r.id}" data-m="${m}">
      <div class="emoji">${emojiFor(r)}</div>
      <div class="info">
        <h3>${esc(r.title)}</h3>
        <div class="meta">⏱ ${totalTime(r)} Min · ${fmtNum(r.servings * m)} Portionen</div>
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
    list.innerHTML = `<div class="empty"><div class="big">🛒</div><p>Die Einkaufsliste ist leer.<br>Plane zuerst Gerichte für die Woche ein.</p></div>`;
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
            ${i.note ? `<small class="warn">⚠︎ ${esc(i.note)}</small>` : ""}
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
