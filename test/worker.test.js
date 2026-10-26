import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { parseEmbed, shortcodeFrom } from "../worker/worker.js";

const media = {
  shortcode: "ABC123",
  display_url: "https://scontent.cdninstagram.com/v/cover.jpg?x=1&y=2",
  owner: { username: "chef" },
  edge_media_to_caption: { edges: [{ node: { text: "Soup\n\n1 onion\n2 carrots\n\nCook 20 min." } }] },
};
const embedHtml = `<html><script>window.__x = {"contextJSON":${JSON.stringify(JSON.stringify({ gql_data: { shortcode_media: media } }))}}</script></html>`;
const fallbackHtml = `<div class="Caption"><a class="CaptionUsername" href="#">chef</a><br />Soup &amp; bread<br />1 onion<div class="CaptionComments"></div><img class="EmbeddedMediaImage" alt="" src="https://scontent.cdninstagram.com/a.jpg?a=1&amp;b=2">`;

test("shortcode from various links", () => {
  assert.equal(shortcodeFrom("https://www.instagram.com/reel/DdPDUujOPUQ/?exln=abc=="), "DdPDUujOPUQ");
  assert.equal(shortcodeFrom("https://instagram.com/p/XYZ_-1/"), "XYZ_-1");
  assert.equal(shortcodeFrom("https://www.instagram.com/someone/reel/QQQ/"), "QQQ");
  assert.equal(shortcodeFrom("https://example.com/reel/abc"), null);
});

test("parses the embed JSON", () => {
  assert.deepEqual(parseEmbed(embedHtml), { author: "chef", caption: media.edge_media_to_caption.edges[0].node.text, image: media.display_url, video: "" });
});

test("falls back to the rendered caption", () => {
  const r = parseEmbed(fallbackHtml);
  assert.equal(r.caption, "Soup & bread\n1 onion");
  assert.equal(r.image, "https://scontent.cdninstagram.com/a.jpg?a=1&b=2");
});

test("worker endpoint returns the post with a proxied image url", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(String(url), "https://www.instagram.com/p/ABC123/embed/captioned/");
    return new Response(embedHtml);
  });
  const res = await worker.fetch(new Request("https://relay.example/?url=https://www.instagram.com/reel/ABC123/", { headers: { Origin: "https://julienvarin.github.io" } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://julienvarin.github.io");
  assert.equal(body.author, "chef");
  assert.equal(body.image, `https://relay.example/img?u=${encodeURIComponent(media.display_url)}`);
});

test("worker rejects other sites and other image hosts", async () => {
  const bad = await worker.fetch(new Request("https://relay.example/?url=x", { headers: { Origin: "https://evil.example" } }));
  assert.equal(bad.status, 403);
  const img = await worker.fetch(new Request("https://relay.example/img?u=" + encodeURIComponent("https://evil.example/a.jpg")));
  assert.equal(img.status, 400);
});

test("video url is passed through the media proxy when Instagram shares it", async (t) => {
  const withVideo = embedHtml.replace(JSON.stringify(JSON.stringify({ gql_data: { shortcode_media: media } })), JSON.stringify(JSON.stringify({ gql_data: { shortcode_media: { ...media, video_url: "https://scontent.cdninstagram.com/v/clip.mp4" } } })));
  t.mock.method(globalThis, "fetch", async () => new Response(withVideo));
  const body = await (await worker.fetch(new Request("https://relay.example/?url=https://www.instagram.com/reel/ABC123/"))).json();
  assert.equal(body.video, `https://relay.example/img?u=${encodeURIComponent("https://scontent.cdninstagram.com/v/clip.mp4")}`);
});

test("media proxy forwards Range for video seeking", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.headers.Range, "bytes=0-99");
    return new Response("x".repeat(100), { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-99/5000", "Accept-Ranges": "bytes" } });
  });
  const res = await worker.fetch(new Request("https://relay.example/img?u=" + encodeURIComponent("https://scontent.cdninstagram.com/v/clip.mp4"), { headers: { Range: "bytes=0-99" } }));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-99/5000");
});

// In-memory stand-in for a Workers KV namespace.
function fakeKv() {
  const data = new Map();
  return {
    data,
    async get(k) { return data.get(k)?.value ?? null; },
    async getWithMetadata(k) { const e = data.get(k); return { value: e?.value ?? null, metadata: e?.metadata ?? null }; },
    async put(k, value, { metadata } = {}) { data.set(k, { value, metadata }); },
    async list({ prefix }) {
      const keys = [...data].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata }));
      return { keys, list_complete: true };
    },
  };
}

const syncEnv = () => ({ RECIPES: fakeKv(), SYNC_TOKEN: "open sesame", ANTHROPIC_API_KEY: "sk-ant-test" });
const call = (env, path, init = {}, token = "open sesame") =>
  worker.fetch(new Request(`https://relay.example${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }), env);

test("sync stores, lists, refuses older copies and leaves tombstones", async () => {
  const env = syncEnv();
  assert.equal((await call(env, "/sync/abc", { method: "PUT", body: JSON.stringify({ id: "abc", updatedAt: 10, title: "Soup" }) })).status, 200);
  assert.deepEqual((await (await call(env, "/sync")).json()).recipes, [{ id: "abc", u: 10, d: 0 }]);
  assert.equal((await (await call(env, "/sync/abc")).json()).title, "Soup");

  const older = await call(env, "/sync/abc", { method: "PUT", body: JSON.stringify({ id: "abc", updatedAt: 5 }) });
  assert.equal(older.status, 409);

  assert.equal((await call(env, "/sync/abc", { method: "DELETE" })).status, 200);
  const [entry] = (await (await call(env, "/sync")).json()).recipes;
  assert.equal(entry.d, 1);
  assert.equal((await call(env, "/sync/abc")).status, 404);
});

test("sync needs the passphrase and the setup", async () => {
  const env = syncEnv();
  assert.equal((await call(env, "/sync", {}, "guess")).status, 401);
  assert.equal((await call({}, "/sync")).status, 501);
  const mismatch = await call(env, "/sync/abc", { method: "PUT", body: JSON.stringify({ id: "other" }) });
  assert.equal(mismatch.status, 400);
});

test("AI requests go to Anthropic with the Worker's key, not the passphrase", async (t) => {
  const env = syncEnv();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    assert.equal(init.headers["x-api-key"], "sk-ant-test");
    assert.equal(init.headers["anthropic-version"], "2023-06-01");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(JSON.parse(init.body).model, "claude-haiku-5-5");
    return new Response(JSON.stringify({ ok: 1 }), { headers: { "Content-Type": "application/json" } });
  });
  const res = await call(env, "/anthropic/v1/messages", { method: "POST", headers: { "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-haiku-5-5" }) });
  assert.equal(res.status, 200);
  assert.equal((await call(env, "/anthropic/v1/messages", { method: "POST", body: "{}" }, "guess")).status, 401);
  assert.equal((await call(env, "/anthropic/v1/models")).status, 404);
});
