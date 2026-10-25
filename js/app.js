import { db } from "./db.js";
import { parseCaption, findDurations } from "./parse.js";
import { aiParse, COURSES, TAGS } from "./ai.js";

// ---------- Small helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const ICON = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 4.5a3 3 0 0 1 0 6M21 20c0-2.6-1.6-4.6-4-5.3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

const COURSE_LABEL = { main: "Main", starter: "Starter", dessert: "Dessert", side: "Side", breakfast: "Breakfast", snack: "Snack", drink: "Drink", sauce: "Sauce" };
const TAG_LABEL = { oven: "Oven", stovetop: "Stovetop", "air-fryer": "Air fryer", "no-cook": "No cook", resting: "Resting", freezer: "Freezer", quick: "Quick", vegetarian: "Vegetarian", vegan: "Vegan" };

const settings = {
  get workerUrl() { return localStorage.getItem("workerUrl") || ""; },
  set workerUrl(v) { localStorage.setItem("workerUrl", v.trim().replace(/\/+$/, "")); },
  get apiKey() { return localStorage.getItem("apiKey") || ""; },
  set apiKey(v) { localStorage.setItem("apiKey", v.trim()); },
};

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- State ----------

let recipes = [];
const filter = { q: "", chip: "" };
const byId = (id) => recipes.find((r) => r.id === id);

async function save(recipe) {
  recipe.updatedAt = Date.now();
  if (!byId(recipe.id)) recipes.unshift(recipe);
  await db.put(recipe);
}

// ---------- Router ----------

// True when the current page was opened from the home list, so "back" can pop history.
let fromHome = false;
let lastView = "";

function route() {
  const [, view, id, sub] = location.hash.split("/");
  const viewKey = view === "r" ? (sub ? "edit" : "detail") : "home";
  if (viewKey === "detail" && lastView === "home") fromHome = true;
  if (viewKey === "home") fromHome = false;
  lastView = viewKey;
  releaseWakeLock();
  if (view === "r" && byId(id)) {
    if (sub === "edit") renderEdit(byId(id));
    else renderDetail(byId(id));
  } else renderHome();
}
window.addEventListener("hashchange", () => {
  closeSheet();
  route();
  window.scrollTo(0, 0);
});

// ---------- Home ----------

function cardMeta(r) {
  const bits = [];
  if (r.course) bits.push(COURSE_LABEL[r.course]);
  if (r.ingredients.length) bits.push(`${r.ingredients.length} ingredients`);
  if (r.tags.length) bits.push(TAG_LABEL[r.tags[0]]);
  return bits.join(" · ") || (r.author ? "@" + r.author : "");
}

function cardHtml(r) {
  const ticked = r.have.length + r.done.length;
  const badge = r.noRecipe
    ? '<span class="badge warn">No recipe text</span>'
    : ticked > 0 && r.steps.length
      ? `<span class="badge">${r.done.length}/${r.steps.length} steps</span>`
      : "";
  const img = r.image
    ? `<img src="${r.image}" alt="" loading="lazy">`
    : `<div class="placeholder">${esc(r.title.slice(0, 1).toUpperCase())}</div>`;
  return `<a class="card" href="#/r/${r.id}">
    <div class="card-img">${img}${badge}</div>
    <div class="card-body"><h3>${esc(r.title)}</h3><p>${esc(cardMeta(r))}</p></div>
  </a>`;
}

function matches(r) {
  if (filter.chip === "todo" && !r.noRecipe) return false;
  if (filter.chip && filter.chip !== "todo" && r.course !== filter.chip && !r.tags.includes(filter.chip)) return false;
  if (!filter.q) return true;
  const hay = norm([r.title, r.author, ...r.ingredients.map((i) => i.text)].join(" "));
  return norm(filter.q).split(/\s+/).every((w) => hay.includes(w));
}

function chipsHtml() {
  const courses = COURSES.filter((c) => recipes.some((r) => r.course === c));
  const tags = TAGS.filter((t) => recipes.some((r) => r.tags.includes(t)));
  const items = [["", "All"], ...courses.map((c) => [c, COURSE_LABEL[c]]), ...tags.map((t) => [t, TAG_LABEL[t]])];
  if (recipes.some((r) => r.noRecipe)) items.push(["todo", "Needs text"]);
  if (items.length < 3) return "";
  return `<div class="chips" role="toolbar">${items
    .map(([k, label]) => `<button class="chip" data-chip="${k}" aria-pressed="${filter.chip === k}">${esc(label)}</button>`)
    .join("")}</div>`;
}

function gridHtml() {
  if (!recipes.length)
    return `<div class="empty"><h2>No recipes yet</h2><p>Tap <b>+</b> and paste an Instagram reel link.<br>Its caption becomes a recipe card.</p></div>`;
  const list = recipes.filter(matches);
  if (!list.length) return `<div class="empty"><p>Nothing matches.</p></div>`;
  return `<div class="grid">${list.map(cardHtml).join("")}</div>`;
}

function renderHome() {
  document.title = "Recipes";
  app.className = "";
  app.innerHTML = `<div class="page">
    <header class="top">
      <h1>Recipes</h1>
      <button class="icon-btn" data-action="settings" aria-label="Settings">${icon("sliders")}</button>
    </header>
    ${recipes.length ? `<label class="search">${icon("search")}<input type="search" id="q" placeholder="Search recipes or ingredients" value="${esc(filter.q)}" autocomplete="off"></label>` : ""}
    <div id="chips">${chipsHtml()}</div>
    <div id="list">${gridHtml()}</div>
  </div>
  <button class="fab" data-action="add" aria-label="Add recipe">${icon("plus")}</button>`;
  $("#q")?.addEventListener("input", (e) => {
    filter.q = e.target.value;
    $("#list").innerHTML = gridHtml();
  });
}

// ---------- Detail ----------

function stepHtml(text) {
  let out = "";
  let pos = 0;
  for (const d of findDurations(text)) {
    out += esc(text.slice(pos, d.index));
    out += `<button class="tchip" data-sec="${d.seconds}" data-label="${esc(d.label)}">${icon("timer")}${esc(d.label)}</button>`;
    pos = d.index + d.length;
  }
  return out + esc(text.slice(pos));
}

function countHtml(n, total) {
  return `<span class="count ${n === total && total ? "full" : ""}">${n}/${total}</span>`;
}

function renderDetail(r) {
  document.title = r.title;
  app.className = r.image ? "" : "no-hero";
  let lastGroup = "";
  const ings = r.ingredients
    .map((ing, i) => {
      let head = "";
      if (ing.group && ing.group !== lastGroup) head = `<li class="group">${esc(ing.group)}</li>`;
      lastGroup = ing.group || lastGroup;
      return `${head}<li><button class="check-row" data-ing="${i}" aria-pressed="${r.have.includes(i)}"><span class="box">${icon("check")}</span><span class="txt">${esc(ing.text)}</span></button></li>`;
    })
    .join("");
  const steps = r.steps
    .map(
      (s, i) =>
        `<li><div class="step" data-step="${i}" role="button" tabindex="0" aria-pressed="${r.done.includes(i)}"><span class="num"><span>${i + 1}</span>${icon("check")}</span><p>${stepHtml(s)}</p></div></li>`
    )
    .join("");
  const chips = [
    r.servings && `<span class="chip static">${icon("users")}${esc(r.servings)}</span>`,
    r.course && `<span class="chip static accent">${COURSE_LABEL[r.course]}</span>`,
    ...r.tags.map((t) => `<span class="chip static">${TAG_LABEL[t] || esc(t)}</span>`),
  ].filter(Boolean);

  app.innerHTML = `
    <div class="hero">
      ${r.image ? `<img src="${r.image}" alt="">` : ""}
      <div class="hero-bar">
        <button class="glass" data-action="home" aria-label="Back">${icon("back")}</button>
        <div>
          ${r.ingredients.length || r.steps.length ? `<button class="glass" data-action="reset" aria-label="Reset checklist">${icon("reset")}</button>` : ""}
          <button class="glass" data-action="more" aria-label="More">${icon("more")}</button>
        </div>
      </div>
    </div>
    <article class="content">
      <h1>${esc(r.title)}</h1>
      <div class="byline">
        ${r.author ? `<span>@${esc(r.author)}</span><span>·</span>` : ""}
        ${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Open reel ${icon("external")}</a>` : ""}
      </div>
      ${chips.length ? `<div class="meta-chips">${chips.join("")}</div>` : ""}
      ${
        r.noRecipe
          ? `<div class="banner"><strong>No recipe text found</strong>This reel's caption doesn't seem to contain the recipe (it may only be in the video).<br><button data-action="edit">Add it by hand</button></div>`
          : ""
      }
      ${
        r.ingredients.length
          ? `<div class="sec-head"><h2>Ingredients</h2><span id="ing-count">${countHtml(r.have.length, r.ingredients.length)}</span></div><ul class="checklist">${ings}</ul>`
          : ""
      }
      ${
        r.steps.length
          ? `<div class="sec-head"><h2>Steps</h2><span id="step-count">${countHtml(r.done.length, r.steps.length)}</span></div><ol class="steps">${steps}</ol>`
          : ""
      }
      ${r.ingredients.length || r.steps.length ? `<button class="ghost-btn" data-action="reset">${icon("reset")}Reset checklist</button>` : ""}
    </article>`;
  app.dataset.id = r.id;
  requestWakeLock();
}

function toggle(r, key, index, el) {
  const list = r[key];
  const at = list.indexOf(index);
  if (at >= 0) list.splice(at, 1);
  else list.push(index);
  el.setAttribute("aria-pressed", String(at < 0));
  if (key === "have") $("#ing-count").innerHTML = countHtml(r.have.length, r.ingredients.length);
  else $("#step-count").innerHTML = countHtml(r.done.length, r.steps.length);
  if (navigator.vibrate) navigator.vibrate(8);
  save(r);
}

async function resetChecks(r) {
  r.have = [];
  r.done = [];
  await save(r);
  renderDetail(r);
  toast("Checklist reset");
}

// Keep the screen on while a recipe is open.
let wakeLock = null;
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    wakeLock = null;
  }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && location.hash.startsWith("#/r/") && !location.hash.endsWith("/edit")) requestWakeLock();
  if (document.visibilityState === "visible") tickTimers();
});

// ---------- Edit ----------

function ingredientsToText(list) {
  let group = "";
  const lines = [];
  for (const ing of list) {
    if (ing.group && ing.group !== group) {
      if (lines.length) lines.push("");
      lines.push(`${ing.group}:`);
      group = ing.group;
    }
    lines.push(ing.text);
  }
  return lines.join("\n");
}

function textToIngredients(text) {
  let group = "";
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith(":") && line.length < 45) group = line.slice(0, -1).trim();
    else out.push({ text: line.replace(/^[-•*]\s*/, ""), group });
  }
  return out;
}

function renderEdit(r) {
  document.title = "Edit · " + r.title;
  app.className = "";
  const pick = (name, values, labels, selected, multi) =>
    values
      .map((v) => `<button type="button" class="chip" data-pick="${name}" data-multi="${multi}" data-value="${v}" aria-pressed="${multi ? selected.includes(v) : selected === v}">${labels[v]}</button>`)
      .join("");
  app.innerHTML = `<div class="page">
    <div class="edit-top">
      <button class="icon-btn" data-action="cancel-edit" aria-label="Cancel">${icon("x")}</button>
      <h1>Edit recipe</h1>
      <button class="save" data-action="save-edit">Save</button>
    </div>
    <form id="edit-form" autocomplete="off">
      <label class="field"><span>Title</span><input class="input" name="title" value="${esc(r.title)}"></label>
      <label class="field"><span>Servings</span><input class="input" name="servings" value="${esc(r.servings)}" placeholder="e.g. 4 people"></label>
      <div class="field"><span>Course</span><div class="chip-pick">${pick("course", COURSES, COURSE_LABEL, r.course, false)}</div></div>
      <div class="field"><span>Tags</span><div class="chip-pick">${pick("tags", TAGS, TAG_LABEL, r.tags, true)}</div></div>
      <label class="field"><span>Ingredients</span><textarea class="input" name="ingredients" rows="10" placeholder="One per line">${esc(ingredientsToText(r.ingredients))}</textarea><small>One per line. A line ending with “:” starts a group (e.g. “Sauce:”).</small></label>
      <label class="field"><span>Steps</span><textarea class="input" name="steps" rows="12" placeholder="One per line">${esc(r.steps.join("\n"))}</textarea><small>One step per line. Durations like “35 min” become timers.</small></label>
      ${r.caption ? `<details class="caption"><summary>Original caption</summary><pre>${esc(r.caption)}</pre></details>` : ""}
    </form>
  </div>`;
}

async function saveEdit(r) {
  const f = $("#edit-form");
  const picked = (name) => [...f.querySelectorAll(`[data-pick="${name}"][aria-pressed="true"]`)].map((b) => b.dataset.value);
  const ingredients = textToIngredients(f.ingredients.value);
  const steps = f.steps.value.split("\n").map((s) => s.trim()).filter(Boolean);
  const changedLists = JSON.stringify(ingredients) !== JSON.stringify(r.ingredients) || JSON.stringify(steps) !== JSON.stringify(r.steps);
  Object.assign(r, {
    title: f.title.value.trim() || "Untitled recipe",
    servings: f.servings.value.trim(),
    course: picked("course")[0] || "",
    tags: picked("tags"),
    ingredients,
    steps,
    noRecipe: ingredients.length === 0 && steps.length === 0,
  });
  if (changedLists) {
    r.have = [];
    r.done = [];
  }
  await save(r);
  location.replace(`#/r/${r.id}`);
}

// ---------- Sheets ----------

function openSheet(html, onMount) {
  closeSheet(true);
  const root = $("#sheet-root");
  root.innerHTML = `<div class="backdrop" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
  onMount?.(root);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("sheet-open")));
}
function closeSheet(instant) {
  const root = $("#sheet-root");
  if (!root.innerHTML) return;
  root.classList.remove("sheet-open");
  if (instant) root.innerHTML = "";
  else setTimeout(() => !root.classList.contains("sheet-open") && (root.innerHTML = ""), 280);
}

function openAdd(prefill = "", autoStart = false) {
  openSheet(
    `<h2>Add a recipe</h2>
    <p class="sub">Paste an Instagram reel link. The caption becomes a recipe card${settings.apiKey ? ", cleaned up by AI" : ""}.</p>
    <div class="field input-row">
      <input class="input" id="add-url" type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…" value="${esc(prefill)}">
      ${navigator.clipboard?.readText ? `<button class="sq" data-action="paste" aria-label="Paste">${icon("paste")}</button>` : ""}
    </div>
    <div id="text-wrap" hidden><label class="field"><span>Caption text</span><textarea class="input" id="add-text" placeholder="Paste the recipe text here"></textarea></label></div>
    <button class="primary" data-action="do-import">Import</button>
    <button class="link-btn" data-action="show-text">No link? Paste the text instead</button>
    <div class="status" id="add-status"></div>`,
    () => {
      const input = $("#add-url");
      input.addEventListener("keydown", (e) => e.key === "Enter" && doImport());
      if (autoStart) doImport();
      else if (!prefill) setTimeout(() => input.focus(), 300);
    }
  );
}

function setStatus(msg, kind = "") {
  const el = $("#add-status");
  if (!el) return;
  el.className = `status ${kind}`;
  el.innerHTML = kind === "busy" ? `<span class="spinner"></span>${esc(msg)}` : esc(msg);
}

let importing = false;
async function doImport() {
  if (importing) return;
  const url = $("#add-url")?.value.trim() || "";
  const pasted = $("#add-text")?.value.trim() || "";
  if (!url && !pasted) return setStatus("Paste a reel link first.", "error");

  importing = true;
  const btn = $('[data-action="do-import"]');
  if (btn) btn.disabled = true;
  try {
    let post = { url: "", shortcode: "", author: "", caption: pasted, image: "" };
    if (url) {
      const code = url.match(/instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/)?.[1];
      if (!code) throw new Error("That doesn't look like an Instagram reel link.");
      const existing = recipes.find((r) => r.shortcode === code);
      if (existing) {
        closeSheet();
        location.hash = `#/r/${existing.id}`;
        return toast("Already in your collection");
      }
      if (!settings.workerUrl) throw new Error("Add your Worker URL in Settings first.");
      setStatus("Fetching the reel…", "busy");
      const res = await fetch(`${settings.workerUrl}/?url=${encodeURIComponent(url)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Worker error ${res.status}`);
      post = { ...data, caption: pasted || data.caption };
      if (data.image) {
        setStatus("Saving the picture…", "busy");
        post.image = await imageToDataUrl(data.image).catch(() => "");
      }
    }

    let parsed;
    let parser = "basic";
    if (post.caption && settings.apiKey) {
      setStatus("Reading the recipe with AI…", "busy");
      try {
        parsed = await aiParse(post.caption, settings.apiKey);
        parser = "ai";
      } catch (err) {
        console.warn(err);
        toast("AI failed, used the basic reader");
      }
    }
    parsed ??= parseCaption(post.caption);
    if (!post.caption) parsed.title = post.author ? `Reel by @${post.author}` : "Untitled recipe";

    const recipe = {
      id: uid(),
      shortcode: post.shortcode || "",
      sourceUrl: post.url || "",
      author: post.author || "",
      caption: post.caption || "",
      image: post.image || "",
      createdAt: Date.now(),
      parser,
      ...parsed,
      have: [],
      done: [],
    };
    await save(recipe);
    closeSheet();
    location.hash = `#/r/${recipe.id}`;
  } catch (err) {
    setStatus(err.message || String(err), "error");
  } finally {
    importing = false;
    if (btn) btn.disabled = false;
  }
}

// Shrink the cover to a reasonable size and keep it as a data URL.
async function imageToDataUrl(src) {
  const blob = await (await fetch(src)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 900 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function reparseWithAi(r) {
  if (!settings.apiKey) return toast("Add an API key in Settings first");
  if (!r.caption) return toast("No caption to read");
  openSheet(`<h2>Re-read with AI</h2><div class="status" id="add-status"></div>`);
  setStatus("Reading the recipe with AI…", "busy");
  try {
    const parsed = await aiParse(r.caption, settings.apiKey);
    Object.assign(r, parsed, { parser: "ai", have: [], done: [] });
    await save(r);
    closeSheet();
    renderDetail(r);
    toast("Recipe updated");
  } catch (err) {
    setStatus(err.message || String(err), "error");
  }
}

function openMore(r) {
  openSheet(`<div class="menu">
      <button data-action="edit">${icon("edit")}Edit</button>
      ${r.caption ? `<button data-action="reparse">${icon("sparkle")}Re-read with AI</button>` : ""}
      ${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${icon("external")}Open reel on Instagram</a>` : ""}
      <button class="danger" data-action="delete">${icon("trash")}Delete recipe</button>
    </div>`);
}

function openSettings() {
  openSheet(
    `<h2>Settings</h2>
    <p class="sub">Saved on this device only.</p>
    <label class="field"><span>Worker URL</span><input class="input" id="s-worker" type="url" placeholder="https://recipes-relay.you.workers.dev" value="${esc(settings.workerUrl)}"><small>Your Cloudflare Worker that reads Instagram reels.</small></label>
    <label class="field"><span>Anthropic API key (optional)</span><input class="input" id="s-key" type="password" placeholder="sk-ant-…" value="${esc(settings.apiKey)}" autocomplete="off"><small>With a key, Claude Haiku cleans up recipes, simplifies the steps and adds tags. Without it, a free basic reader is used.</small></label>
    <button class="primary" data-action="save-settings">Save</button>
    <div class="divider"></div>
    <p class="sub" style="margin-bottom:10px">Backup: your recipes live in this browser. Export them now and then.</p>
    <div class="row-2">
      <button class="secondary" data-action="export">${icon("download")}Export</button>
      <button class="secondary" data-action="import-file">${icon("upload")}Import</button>
    </div>
    <input type="file" id="import-input" accept="application/json,.json" hidden>`,
    (root) => $("#import-input", root).addEventListener("change", importBackup)
  );
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: "recipes", version: 1, recipes }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `recipes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.recipes;
    let added = 0;
    for (const r of list) {
      if (!r?.id || !Array.isArray(r.ingredients) || byId(r.id)) continue;
      await db.put(r);
      recipes.push(r);
      added++;
    }
    recipes.sort((a, b) => b.createdAt - a.createdAt);
    closeSheet();
    route();
    toast(`Imported ${added} recipe${added === 1 ? "" : "s"}`);
  } catch {
    toast("That file isn't a recipes backup");
  }
}

// ---------- Timers ----------
// Stored with their end time, so they survive reloads and the app sleeping.

let timers = JSON.parse(localStorage.getItem("timers") || "[]");
let tickHandle = null;
let audioCtx = null;

const saveTimers = () => localStorage.setItem("timers", JSON.stringify(timers));
const remaining = (t) => (t.pausedLeft != null ? t.pausedLeft : Math.max(0, Math.round((t.end - Date.now()) / 1000)));
const fmt = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

function startTimer(recipe, stepIndex, seconds, label) {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume?.();
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  timers.push({ id: uid(), recipeId: recipe.id, label: `Step ${stepIndex + 1} · ${recipe.title}`, end: Date.now() + seconds * 1000, fired: false });
  saveTimers();
  tickTimers();
  toast(`Timer started: ${label}`);
}

function beep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, now + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.3, now + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(now + i * 0.35);
    o.stop(now + i * 0.35 + 0.3);
  }
}

function fire(t) {
  t.fired = true;
  saveTimers();
  beep();
  navigator.vibrate?.([300, 120, 300, 120, 500]);
  if ("Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification("Timer done", { body: t.label, tag: t.id }))
      .catch(() => new Notification("Timer done", { body: t.label }));
  }
}

function tickTimers() {
  for (const t of timers) if (!t.fired && t.pausedLeft == null && remaining(t) === 0) fire(t);
  const el = $("#timers");
  el.innerHTML = timers
    .map((t) => {
      const left = remaining(t);
      const done = t.fired;
      return `<div class="timer ${done ? "done" : ""} ${t.pausedLeft != null ? "paused" : ""}" data-timer="${t.id}">
        <span class="t-label" data-action="timer-open">${esc(t.label)}</span>
        <span class="t-time">${done ? "Done" : fmt(left)}</span>
        ${done ? "" : `<button data-action="timer-pause" aria-label="${t.pausedLeft != null ? "Resume" : "Pause"}">${icon(t.pausedLeft != null ? "play" : "pause")}</button>`}
        <button data-action="timer-close" aria-label="Dismiss">${icon("x")}</button>
      </div>`;
    })
    .join("");
  document.body.classList.toggle("has-timers", timers.length > 0);
  if (timers.length && !tickHandle) tickHandle = setInterval(tickTimers, 1000);
  if (!timers.length && tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function timerAction(action, id) {
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  if (action === "timer-close") timers = timers.filter((x) => x !== t);
  if (action === "timer-pause") {
    if (t.pausedLeft != null) {
      t.end = Date.now() + t.pausedLeft * 1000;
      delete t.pausedLeft;
    } else t.pausedLeft = remaining(t);
  }
  if (action === "timer-open") {
    if (byId(t.recipeId)) location.hash = `#/r/${t.recipeId}`;
    if (t.fired) timers = timers.filter((x) => x !== t);
  }
  saveTimers();
  tickTimers();
}

// ---------- Events ----------

document.addEventListener("click", async (e) => {
  const current = byId(app.dataset.id);

  const chip = e.target.closest("[data-chip]");
  if (chip) {
    filter.chip = filter.chip === chip.dataset.chip ? "" : chip.dataset.chip;
    $("#chips").innerHTML = chipsHtml();
    $("#list").innerHTML = gridHtml();
    return;
  }

  const pick = e.target.closest("[data-pick]");
  if (pick) {
    const on = pick.getAttribute("aria-pressed") !== "true";
    if (pick.dataset.multi === "false") pick.parentElement.querySelectorAll("[data-pick]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    pick.setAttribute("aria-pressed", String(on));
    return;
  }

  const tchip = e.target.closest(".tchip");
  if (tchip && current) {
    const step = +tchip.closest("[data-step]").dataset.step;
    startTimer(current, step, +tchip.dataset.sec, tchip.dataset.label);
    return;
  }

  const ing = e.target.closest("[data-ing]");
  if (ing && current) return toggle(current, "have", +ing.dataset.ing, ing);
  const step = e.target.closest("[data-step]");
  if (step && current) return toggle(current, "done", +step.dataset.step, step);

  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action.startsWith("timer-")) return timerAction(action, el.closest("[data-timer]").dataset.timer);

  switch (action) {
    case "home":
      if (fromHome) history.back();
      else location.replace("#/");
      break;
    case "add":
      openAdd();
      break;
    case "settings":
      openSettings();
      break;
    case "close-sheet":
      closeSheet();
      break;
    case "paste":
      try {
        $("#add-url").value = (await navigator.clipboard.readText()).trim();
      } catch {
        toast("Clipboard not available, paste by hand");
      }
      break;
    case "show-text":
      $("#text-wrap").hidden = false;
      el.hidden = true;
      $("#add-text").focus();
      break;
    case "do-import":
      doImport();
      break;
    case "reset":
      if (current) resetChecks(current);
      break;
    case "more":
      if (current) openMore(current);
      break;
    case "edit":
      if (current) location.hash = `#/r/${current.id}/edit`;
      break;
    case "reparse":
      if (current) reparseWithAi(current);
      break;
    case "delete":
      if (current && confirm(`Delete “${current.title}”?`)) {
        await db.remove(current.id);
        recipes = recipes.filter((r) => r !== current);
        location.replace("#/");
      }
      break;
    case "cancel-edit":
      if (current) location.replace(`#/r/${current.id}`);
      break;
    case "save-edit":
      if (current) saveEdit(current);
      break;
    case "save-settings":
      settings.workerUrl = $("#s-worker").value;
      settings.apiKey = $("#s-key").value;
      closeSheet();
      toast("Settings saved");
      break;
    case "export":
      exportBackup();
      break;
    case "import-file":
      $("#import-input").click();
      break;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-step]")) {
    e.preventDefault();
    e.target.click();
  }
});

// ---------- Start ----------

async function start() {
  recipes = (await db.all()).sort((a, b) => b.createdAt - a.createdAt);
  route();
  tickTimers();

  // Opened from the Android share sheet (or a ?url= link).
  const params = new URLSearchParams(location.search);
  const shared = [params.get("url"), params.get("text"), params.get("title")].join(" ");
  const link = shared.match(/https?:\/\/(?:www\.)?instagram\.com\/\S+/)?.[0];
  if (link) {
    history.replaceState(null, "", location.pathname + location.hash);
    openAdd(link, true);
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
}
start();
