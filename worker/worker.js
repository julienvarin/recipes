// Cloudflare Worker: tiny relay between the recipe app and Instagram.
//
//   GET /?url=<instagram reel or post url>  -> { shortcode, url, author, caption, image }
//   GET /img?u=<instagram cdn image url>    -> the image bytes (so the app can store it)
//
// It only talks to instagram.com and Instagram's image CDN.

// Sites allowed to call this worker. Add your own GitHub Pages address if it differs.
const ALLOWED_ORIGINS = [
  "https://julienvarin.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origin not allowed" }, 403, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === "/img") return await proxyImage(url.searchParams.get("u"), cors);
      const target = url.searchParams.get("url");
      if (!target) return json({ ok: true, usage: "GET /?url=<instagram reel url>" }, 200, cors);
      const post = await fetchPost(target);
      if (post.image) post.image = `${url.origin}/img?u=${encodeURIComponent(post.image)}`;
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

  // Preferred source: the JSON blob the embed page ships with.
  const m = html.match(/"contextJSON":("(?:[^"\\]|\\.)*")/);
  if (m) {
    try {
      const media = JSON.parse(JSON.parse(m[1]))?.gql_data?.shortcode_media;
      if (media) {
        caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || "";
        author = media.owner?.username || "";
        image = media.display_url || media.thumbnail_src || "";
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
  return { author, caption, image };
}

async function proxyImage(u, cors) {
  let host;
  try {
    host = new URL(u).hostname;
  } catch {
    throw httpError("Bad image url", 400);
  }
  if (!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(host)) throw httpError("Image host not allowed", 400);
  const res = await fetch(u, { headers: { "User-Agent": UA } });
  if (!res.ok) throw httpError(`Image fetch failed (${res.status})`, 502);
  return new Response(res.body, {
    headers: { ...cors, "Content-Type": res.headers.get("Content-Type") || "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
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
