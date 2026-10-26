// Cloudflare Worker: tiny relay between the recipe app and Instagram.
//
//   GET /?url=<instagram reel or post url>  -> { shortcode, url, author, caption, image, video }
//   GET /img?u=<instagram cdn url>          -> the image or video bytes (so the app can use them)
//
// `video` is only there when Instagram shares the file publicly (often not for reels with music).
//
// Sync between devices (needs the RECIPES KV binding and the SYNC_TOKEN secret;
// every call sends `Authorization: Bearer <SYNC_TOKEN>`):
//
//   GET    /sync           -> { ai, recipes: [{ id, u, d }] }  (u = updatedAt, d = deleted)
//   GET    /sync/<id>      -> the recipe
//   PUT    /sync/<id>      <- the recipe; 409 if the stored copy is newer
//   DELETE /sync/<id>      -> leaves a tombstone so other devices delete it too
//   POST   /anthropic/...  -> forwarded to api.anthropic.com with the ANTHROPIC_API_KEY secret
//
// Otherwise it only talks to instagram.com and Instagram's image CDN.

// Sites allowed to call this worker. Add your own GitHub Pages address if it differs.
const ALLOWED_ORIGINS = [
  "https://julienvarin.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "Range",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origin not allowed" }, 403, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === "/sync" || url.pathname.startsWith("/sync/")) return await sync(request, url, env, cors);
      if (url.pathname.startsWith("/anthropic/")) return await anthropic(request, url, env, cors);
      if (url.pathname === "/img") return await proxyMedia(url.searchParams.get("u"), request, cors);
      const target = url.searchParams.get("url");
      if (!target) return json({ ok: true, usage: "GET /?url=<instagram reel url>" }, 200, cors);
      const post = await fetchPost(target);
      if (post.image) post.image = `${url.origin}/img?u=${encodeURIComponent(post.image)}`;
      if (post.video) post.video = `${url.origin}/img?u=${encodeURIComponent(post.video)}`;
      return json(post, 200, cors);
    } catch (err) {
      return json({ error: err.message || String(err) }, err.status || 500, cors);
    }
  },
};

export function shortcodeFrom(input) {
  const m = String(input || "").match(/instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function fetchPost(target) {
  const shortcode = shortcodeFrom(target);
  if (!shortcode) throw httpError("This is not an Instagram reel or post link", 400);

  const res = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,fr;q=0.8" },
  });
  if (!res.ok) throw httpError(`Instagram answered ${res.status}`, 502);
  const html = await res.text();

  const post = parseEmbed(html);
  if (!post.caption && !post.image) throw httpError("Could not read this post (private or removed?)", 404);
  return { shortcode, url: `https://www.instagram.com/reel/${shortcode}/`, ...post };
}

export function parseEmbed(html) {
  let caption = "";
  let author = "";
  let image = "";
  let video = "";

  // Preferred source: the JSON blob the embed page ships with.
  const m = html.match(/"contextJSON":("(?:[^"\\]|\\.)*")/);
  if (m) {
    try {
      const media = JSON.parse(JSON.parse(m[1]))?.gql_data?.shortcode_media;
      if (media) {
        caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || "";
        author = media.owner?.username || "";
        image = media.display_url || media.thumbnail_src || "";
        video = media.video_url || "";
      }
    } catch {
      // fall through to the HTML fallback
    }
  }

  // Fallback: scrape the rendered caption and image.
  if (!caption) {
    const c = html.match(/class="Caption">([\s\S]*?)<div class="CaptionComments/);
    if (c) {
      const body = c[1].replace(/<a class="CaptionUsername"[\s\S]*?<\/a>/, "");
      caption = decodeEntities(body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
    }
  }
  if (!author) author = (html.match(/class="UsernameText">([^<]+)</) || [])[1] || "";
  if (!image) {
    const i = html.match(/class="EmbeddedMediaImage"[^>]*?src="([^"]+)"/);
    if (i) image = decodeEntities(i[1]);
  }
  return { author, caption, image, video };
}

async function proxyMedia(u, request, cors) {
  let host;
  try {
    host = new URL(u).hostname;
  } catch {
    throw httpError("Bad image url", 400);
  }
  if (!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(host)) throw httpError("Media host not allowed", 400);
  // Forward Range so a <video> element can seek without downloading the whole file.
  const headers = { "User-Agent": UA };
  const range = request.headers.get("Range");
  if (range) headers.Range = range;
  const res = await fetch(u, { headers });
  if (!res.ok) throw httpError(`Media fetch failed (${res.status})`, 502);
  const out = {
    ...cors,
    "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  };
  for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) if (res.headers.get(h)) out[h] = res.headers.get(h);
  return new Response(res.body, { status: res.status, headers: out });
}

// ---------- Sync ----------

const MAX_RECIPE_BYTES = 20 * 1024 * 1024; // KV values can be up to 25 MiB

function authorize(request, env) {
  if (!env.SYNC_TOKEN) throw httpError("Sync isn’t set up on the Worker (add the SYNC_TOKEN secret)", 501);
  const sent = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!sent || !safeEqual(sent, env.SYNC_TOKEN)) throw httpError("Wrong sync passphrase", 401);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sync(request, url, env, cors) {
  authorize(request, env);
  const kv = env.RECIPES;
  if (!kv) throw httpError("Sync isn’t set up on the Worker (no RECIPES storage)", 501);

  const id = decodeURIComponent(url.pathname.slice("/sync/".length));
  if (url.pathname === "/sync") {
    if (request.method !== "GET") throw httpError("Method not allowed", 405);
    const recipes = [];
    let cursor;
    do {
      const page = await kv.list({ prefix: "r:", cursor });
      for (const k of page.keys) recipes.push({ id: k.name.slice(2), u: k.metadata?.u || 0, d: k.metadata?.d ? 1 : 0 });
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return json({ ai: !!env.ANTHROPIC_API_KEY, recipes }, 200, cors);
  }
  if (!/^[\w-]{1,64}$/.test(id)) throw httpError("Bad recipe id", 400);
  const key = `r:${id}`;

  if (request.method === "GET") {
    const value = await kv.get(key);
    if (!value) throw httpError("Not found", 404);
    return new Response(value, { headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
  }
  if (request.method === "PUT") {
    const body = await request.text();
    if (body.length > MAX_RECIPE_BYTES) throw httpError("Recipe too big to sync", 413);
    let recipe;
    try {
      recipe = JSON.parse(body);
    } catch {
      throw httpError("Not JSON", 400);
    }
    if (recipe?.id !== id) throw httpError("Recipe id doesn’t match", 400);
    const u = Number(recipe.updatedAt || recipe.createdAt) || 0;
    const { metadata } = await kv.getWithMetadata(key);
    if (metadata?.u > u) return json({ error: "A newer copy is already synced", u: metadata.u }, 409, cors);
    await kv.put(key, body, { metadata: { u } });
    return json({ ok: true, u }, 200, cors);
  }
  if (request.method === "DELETE") {
    const u = Date.now();
    await kv.put(key, "", { metadata: { u, d: 1 } });
    return json({ ok: true, u }, 200, cors);
  }
  throw httpError("Method not allowed", 405);
}

// Lets the app's Anthropic SDK use the key stored on the Worker: the request is passed
// through unchanged, except that the sync passphrase is swapped for the API key.
async function anthropic(request, url, env, cors) {
  authorize(request, env);
  if (!env.ANTHROPIC_API_KEY) throw httpError("No Anthropic API key on the Worker", 501);
  if (request.method !== "POST" || url.pathname !== "/anthropic/v1/messages") throw httpError("Not allowed", 404);
  const headers = { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY };
  for (const h of ["anthropic-version", "anthropic-beta"]) if (request.headers.get(h)) headers[h] = request.headers.get(h);
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: await request.text() });
  const out = { ...cors, "Content-Type": res.headers.get("Content-Type") || "application/json" };
  const rid = res.headers.get("request-id");
  if (rid) out["request-id"] = rid;
  return new Response(res.body, { status: res.status, headers: out });
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
