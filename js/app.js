import { db } from "./db.js";
import { parseCaption, findDurations } from "./parse.js";
import { aiParse, COURSES, TAGS } from "./ai.js";
import { normalizeIngredient, sortIngredients } from "./ingredients.js";

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
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  redo: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
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
  const viewKey = view === "r" ? "detail" : "home";
  const editing = editingId && byId(editingId);
  if (editing && !(view === "r" && id === editingId)) finishEdit(editing);
  if (view === "r" && sub === "edit") editingId = id;
  if (viewKey === "detail" && lastView === "home") fromHome = true;
  if (viewKey === "home") fromHome = false;
  lastView = viewKey;
  releaseWakeLock();
  if (view === "r" && byId(id)) renderDetail(byId(id));
  else renderHome();
}
window.addEventListener("hashchange", () => {
  closeSheet();
  route();
  window.scrollTo(0, 0);
});

// ---------- Home ----------

function cardHtml(r) {
  const img = r.image
    ? `<img src="${r.image}" alt="" loading="lazy">`
    : "";
  return `<a class="card" href="#/r/${r.id}">
    <div class="card-img">${img}</div>
    <div class="card-body"><h3>${esc(r.title)}</h3></div>
  </a>`;
}

function matches(r) {
  if (filter.chip === "todo" && !r.noRecipe) return false;
  if (filter.chip && filter.chip !== "todo" && r.course !== filter.chip && !r.tags.includes(filter.chip)) return false;
  if (!filter.q) return true;
  const hay = norm([r.title, r.author, ...r.ingredients.map((i) => i.name)].join(" "));
  return norm(filter.q).split(/\s+/).every((w) => hay.includes(w));
}

function chipsHtml() {
  const courses = COURSES.filter((c) => recipes.some((r) => r.course === c));
  const tags = allTags({ tags: [] }).filter((t) => recipes.some((r) => r.tags.includes(t)));
  const items = [["", "All"], ...courses.map((c) => [c, COURSE_LABEL[c]]), ...tags.map((t) => [t, tagLabel(t)])];
  if (recipes.some((r) => r.noRecipe)) items.push(["todo", "Needs text"]);
  if (items.length < 3) return "";
  return `<div class="chips" role="toolbar">${items
    .map(([k, label]) => `<button class="chip" data-chip="${k}" aria-pressed="${filter.chip === k}">${esc(label)}</button>`)
    .join("")}</div>`;
}

function gridHtml() {
  if (!recipes.length)
    return `<div class="empty"><p>Your collection is empty.</p><button class="primary" data-action="add">${icon("plus")}Add a recipe</button></div>`;
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
  ${recipes.length ? `<button class="fab" data-action="add" aria-label="Add a recipe">${icon("plus")}</button>` : ""}`;
  $("#q")?.addEventListener("input", (e) => {
    filter.q = e.target.value;
    $("#list").innerHTML = gridHtml();
  });
}

// ---------- Detail ----------

// The recipe being edited in place (null when just viewing).
let editingId = null;

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

function groupHead(ing, prev) {
  return ing.group && ing.group !== (prev?.group || "") ? `<li class="group">${esc(ing.group)}</li>` : "";
}

function metaChipsHtml(r) {
  const chips = [
    r.servings && editingId !== r.id && `<span class="chip static">${icon("users")}${esc(r.servings)}</span>`,
    r.course && `<button class="chip static" data-action="tags">${COURSE_LABEL[r.course]}</button>`,
    ...r.tags.map((t) => `<button class="chip static" data-action="tags">${esc(tagLabel(t))}</button>`),
    `<button class="chip static add" data-action="tags" aria-label="Add a tag">${icon("plus")}</button>`,
  ].filter(Boolean);
  return chips.join("");
}

function tagEditorHtml(r) {
  const chip = (attr, value, label, on) => `<button type="button" class="chip" ${attr}="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
  return `<h3>Course</h3>
    <div class="chip-pick">${COURSES.map((c) => chip("data-course", c, COURSE_LABEL[c], r.course === c)).join("")}</div>
    <h3>Tags</h3>
    <div class="chip-pick">
      ${allTags(r).map((t) => chip("data-tag", t, tagLabel(t), r.tags.includes(t))).join("")}
      <span class="tag-add"><input id="new-tag" placeholder="New tag" enterkeyhint="done" autocomplete="off"><button type="button" data-action="add-tag" aria-label="Add tag">${icon("plus")}</button></span>
    </div>`;
}

function ingredientsView(r) {
  return r.ingredients
    .map(
      (ing, i) =>
        `${groupHead(ing, r.ingredients[i - 1])}<li><button class="check-row" data-ing="${i}" aria-pressed="${r.have.includes(i)}"><span class="box">${icon("check")}</span><span class="txt">${esc(ing.name)}</span>${ing.qty ? `<span class="qty">${esc(ing.qty)}</span>` : ""}</button></li>`
    )
    .join("");
}

function ingredientsEdit(r) {
  return (
    r.ingredients
      .map(
        (ing, i) =>
          `${groupHead(ing, r.ingredients[i - 1])}<li class="edit-row"><button class="del" data-action="del-ing" data-i="${i}" aria-label="Remove">${icon("x")}</button><input class="name-input" data-field="ing-name" data-i="${i}" value="${esc(ing.name)}" placeholder="Ingredient" enterkeyhint="next"><input class="qty-input" data-field="ing-qty" data-i="${i}" value="${esc(ing.qty)}" placeholder="Qty" enterkeyhint="next"></li>`
      )
      .join("") + `<li><button class="add-row" data-action="add-ing">${icon("plus")}Add ingredient</button></li>`
  );
}

function stepsView(r) {
  return r.steps
    .map(
      (s, i) =>
        `<li><div class="step" data-step="${i}" role="button" tabindex="0" aria-pressed="${r.done.includes(i)}"><span class="num"><span>${i + 1}</span>${icon("check")}</span><p>${stepHtml(s)}</p></div></li>`
    )
    .join("");
}

function stepsEdit(r) {
  return (
    r.steps
      .map(
        (s, i) =>
          `<li><div class="step editing"><span class="num"><span>${i + 1}</span></span><textarea data-field="step" data-i="${i}" rows="1" placeholder="Describe this step">${esc(s)}</textarea><button class="del" data-action="del-step" data-i="${i}" aria-label="Remove">${icon("x")}</button></div></li>`
      )
      .join("") + `<li><button class="add-row card-like" data-action="add-step">${icon("plus")}Add step</button></li>`
  );
}

function renderDetail(r) {
  const editing = editingId === r.id;
  document.title = r.title;
  app.className = r.image ? "" : "no-hero";
  const hasLists = r.ingredients.length || r.steps.length;

  app.innerHTML = `
    <div class="hero">
      ${r.image ? `<img src="${r.image}" alt="">` : ""}
      <div class="hero-bar">
        <button class="glass" data-action="home" aria-label="Back">${icon("back")}</button>
        <div>
          ${
            editing
              ? `<button class="glass pill" data-action="done-edit">${icon("check")}Done</button>`
              : `<button class="glass" data-action="edit" aria-label="Edit">${icon("edit")}</button>`
          }
          <button class="glass" data-action="more" aria-label="More">${icon("more")}</button>
        </div>
      </div>
    </div>
    <article class="content ${editing ? "is-editing" : ""}">
      ${editing ? `<textarea class="edit-title" data-field="title" rows="1" placeholder="Recipe name">${esc(r.title)}</textarea>` : `<h1>${esc(r.title)}</h1>`}
      <div class="byline">
        ${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${r.author ? "@" + esc(r.author) : "Instagram"}</a>` : r.author ? "@" + esc(r.author) : ""}
      </div>
      ${
        editing
          ? `<label class="servings-edit">${icon("users")}<input data-field="servings" value="${esc(r.servings)}" placeholder="Servings (e.g. 4 personnes)"></label>
             <div class="meta-chips">${metaChipsHtml(r)}</div>`
          : `<div class="meta-chips">${metaChipsHtml(r)}</div>`
      }
      ${
        r.noRecipe && !editing
          ? `<div class="banner"><strong>No recipe text found</strong>This reel’s caption doesn’t contain the recipe. It may only be in the video.<br><button data-action="edit">Add it by hand</button></div>`
          : ""
      }
      ${
        r.ingredients.length || editing
          ? `<div class="sec-head"><h2>Ingredients</h2><span id="ing-count">${editing ? "" : countHtml(r.have.length, r.ingredients.length)}</span></div>
             <ul class="checklist">${editing ? ingredientsEdit(r) : ingredientsView(r)}</ul>`
          : ""
      }
      ${
        r.steps.length || editing
          ? `<div class="sec-head"><h2>Steps</h2><span id="step-count">${editing ? "" : countHtml(r.done.length, r.steps.length)}</span></div>
             <ol class="steps">${editing ? stepsEdit(r) : stepsView(r)}</ol>`
          : ""
      }
      ${hasLists && !editing ? `<button class="ghost-btn" data-action="reset">${icon("reset")}Reset checklist</button>` : ""}
      ${editing && r.caption ? `<details class="caption"><summary>Original caption</summary><pre>${esc(r.caption)}</pre></details>` : ""}
    </article>`;
  app.dataset.id = r.id;
  app.querySelectorAll("textarea").forEach(autosize);
  requestWakeLock();
}

function autosize(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
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
  if (document.visibilityState === "visible" && location.hash.startsWith("#/r/")) requestWakeLock();
  if (document.visibilityState === "visible") tickTimers();
});

// ---------- Editing in place ----------

let saveTimer;
function saveSoon(r) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(r), 400);
}

// Remove index i from a list of checked indices, shifting the ones after it.
const dropIndex = (list, i) => list.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));

function startEdit(r) {
  editingId = r.id;
  renderDetail(r);
}

function finishEdit(r) {
  for (let i = r.ingredients.length - 1; i >= 0; i--) {
    const ing = r.ingredients[i];
    if (!ing.name.trim() && !ing.qty.trim()) {
      r.ingredients.splice(i, 1);
      r.have = dropIndex(r.have, i);
    } else if (!ing.name.trim()) {
      r.ingredients[i] = { ...ing, name: ing.qty, qty: "" };
    }
  }
  r.ingredients = r.ingredients.map(normalizeIngredient);
  for (let i = r.steps.length - 1; i >= 0; i--) {
    r.steps[i] = r.steps[i].trim();
    if (!r.steps[i]) {
      r.steps.splice(i, 1);
      r.done = dropIndex(r.done, i);
    }
  }
  r.title = r.title.trim() || "Untitled recipe";
  r.servings = r.servings.trim();
  r.noRecipe = !r.ingredients.length && !r.steps.length;
  editingId = null;
  clearTimeout(saveTimer);
  save(r);
}

function onEditInput(r, el) {
  const i = +el.dataset.i;
  const field = el.dataset.field;
  if (field === "title") r.title = el.value;
  if (field === "servings") r.servings = el.value;
  if (field === "ing-name") r.ingredients[i].name = el.value;
  if (field === "ing-qty") r.ingredients[i].qty = el.value;
  if (field === "step") r.steps[i] = el.value;
  if (el.tagName === "TEXTAREA") autosize(el);
  saveSoon(r);
}

function addIngredient(r) {
  r.ingredients.push({ qty: "", name: "", group: r.ingredients.at(-1)?.group || "" });
  renderDetail(r);
  $(`[data-field="ing-name"][data-i="${r.ingredients.length - 1}"]`)?.focus();
}

function addStep(r) {
  r.steps.push("");
  renderDetail(r);
  $(`[data-field="step"][data-i="${r.steps.length - 1}"]`)?.focus();
}

// ---------- Tags ----------

const tagLabel = (t) => TAG_LABEL[t] || t;

// Preset tags first, then custom tags used by any recipe.
function allTags(r) {
  const custom = new Set();
  for (const x of [...recipes, r]) for (const t of x.tags) if (!TAGS.includes(t)) custom.add(t);
  return [...TAGS, ...[...custom].sort((a, b) => a.localeCompare(b))];
}

function refreshTags(r) {
  save(r);
  const sheet = $("#sheet-tags");
  if (sheet) sheet.innerHTML = tagEditorHtml(r);
  const row = $(".meta-chips");
  if (row) row.innerHTML = metaChipsHtml(r);
}

function addTag(r) {
  const input = $("#new-tag");
  const value = input?.value.trim().replace(/\s+/g, " ");
  if (!value) return input?.focus();
  const known = allTags(r).find((t) => t.toLowerCase() === value.toLowerCase() || tagLabel(t).toLowerCase() === value.toLowerCase());
  const tag = known || value;
  if (!r.tags.includes(tag)) r.tags.push(tag);
  refreshTags(r);
  $("#new-tag")?.focus();
}

function openTagSheet(r) {
  openSheet(
    `<div class="tag-editor" id="sheet-tags">${tagEditorHtml(r)}</div>
     <button class="primary" data-action="close-sheet" style="margin-top:22px">Done</button>`
  );
}

// ---------- Ingredient order ----------

/** Normalise, then sort by kind and amount, remapping the checked items. */
function tidyIngredients(r) {
  const sorted = sortIngredients(r.ingredients.map(normalizeIngredient));
  const moved = new Map(sorted.map((k, n) => [k.index, n]));
  r.have = (r.have || []).map((i) => moved.get(i)).filter((i) => i != null);
  r.ingredients = sorted.map((k) => k.ing);
  r.v = 2;
  return r;
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
    <div class="field input-row">
      <input class="input" id="add-url" type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…" value="${esc(prefill)}">
      ${navigator.clipboard?.readText ? `<button class="sq" data-action="paste">Paste</button>` : ""}
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
      if (!code) throw new Error("That doesn’t look like an Instagram reel link.");
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
    parsed.ingredients = tidyIngredients({ ingredients: parsed.ingredients }).ingredients;
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
      v: 2,
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
    tidyIngredients(r);
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
      ${r.ingredients.length || r.steps.length ? `<button data-action="reset">${icon("reset")}Reset checklist</button>` : ""}
      ${r.caption ? `<button data-action="reparse">${icon("redo")}Re-read with AI</button>` : ""}
      ${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${icon("external")}Open reel on Instagram</a>` : ""}
      <button class="danger" data-action="delete">${icon("trash")}Delete recipe</button>
    </div>`);
}

function openSettings() {
  openSheet(
    `<h2>Settings</h2>
    <label class="field"><span>Worker URL</span><input class="input" id="s-worker" type="url" placeholder="https://recipes-relay.you.workers.dev" value="${esc(settings.workerUrl)}"></label>
    <label class="field"><span>Anthropic API key</span><input class="input" id="s-key" type="password" placeholder="sk-ant-…" value="${esc(settings.apiKey)}" autocomplete="off"><small>Optional. Cleans up recipes with Claude Haiku.</small></label>
    <button class="primary" data-action="save-settings">Save</button>
    <div class="divider"></div>
    <h3>Backup</h3>
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
      if ((r.v || 1) < 2) tidyIngredients(r);
      await db.put(r);
      recipes.push(r);
      added++;
    }
    recipes.sort((a, b) => b.createdAt - a.createdAt);
    closeSheet();
    route();
    toast(`Imported ${added} recipe${added === 1 ? "" : "s"}`);
  } catch {
    toast("That file isn’t a recipes backup");
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

function startTimer(recipe, stepIndex, seconds) {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume?.();
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  timers.push({ id: uid(), recipeId: recipe.id, step: stepIndex + 1, title: recipe.title, end: Date.now() + seconds * 1000, fired: false });
  saveTimers();
  tickTimers();
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
      .then((reg) => reg.showNotification(`Step ${t.step} is done`, { body: t.title, tag: t.id }))
      .catch(() => new Notification(`Step ${t.step} is done`, { body: t.title }));
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
        <span class="t-label" data-action="timer-open">${t.step ? `<b>Step ${t.step}</b> ${esc(t.title)}` : esc(t.label)}</span>
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

  const course = e.target.closest("[data-course]");
  if (course && current) {
    current.course = current.course === course.dataset.course ? "" : course.dataset.course;
    return refreshTags(current);
  }
  const tag = e.target.closest("[data-tag]");
  if (tag && current) {
    const t = tag.dataset.tag;
    current.tags = current.tags.includes(t) ? current.tags.filter((x) => x !== t) : [...current.tags, t];
    return refreshTags(current);
  }

  const tchip = e.target.closest(".tchip");
  if (tchip && current) {
    const step = +tchip.closest("[data-step]").dataset.step;
    startTimer(current, step, +tchip.dataset.sec);
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
      closeSheet();
      if (current) resetChecks(current);
      break;
    case "more":
      if (current) openMore(current);
      break;
    case "edit":
      if (current) {
        closeSheet();
        startEdit(current);
      }
      break;
    case "done-edit":
      if (current) {
        finishEdit(current);
        renderDetail(current);
      }
      break;
    case "del-ing":
      if (current) {
        current.ingredients.splice(+el.dataset.i, 1);
        current.have = dropIndex(current.have, +el.dataset.i);
        saveSoon(current);
        renderDetail(current);
      }
      break;
    case "add-ing":
      if (current) addIngredient(current);
      break;
    case "del-step":
      if (current) {
        current.steps.splice(+el.dataset.i, 1);
        current.done = dropIndex(current.done, +el.dataset.i);
        saveSoon(current);
        renderDetail(current);
      }
      break;
    case "add-step":
      if (current) addStep(current);
      break;
    case "tags":
      if (current) openTagSheet(current);
      break;
    case "add-tag":
      if (current) addTag(current);
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

document.addEventListener("input", (e) => {
  const r = byId(app.dataset.id);
  if (r && editingId === r.id && e.target.dataset.field) onEditInput(r, e.target);
});

document.addEventListener("keydown", (e) => {
  const r = byId(app.dataset.id);
  if (e.key === "Enter" && e.target.id === "new-tag" && r) {
    e.preventDefault();
    return addTag(r);
  }
  // Enter in an ingredient jumps to the next one, or adds a new row after the last.
  if (e.key === "Enter" && r && /^ing-/.test(e.target.dataset.field || "")) {
    e.preventDefault();
    const next = $(`[data-field="ing-name"][data-i="${+e.target.dataset.i + 1}"]`);
    if (next) next.focus();
    else addIngredient(r);
    return;
  }
  if (e.key === "Escape") closeSheet();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-step]")) {
    e.preventDefault();
    e.target.click();
  }
});

// ---------- Start ----------

async function start() {
  recipes = (await db.all()).sort((a, b) => b.createdAt - a.createdAt);
  for (const r of recipes) if ((r.v || 1) < 2) db.put(tidyIngredients(r));
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
