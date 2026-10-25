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
  assert.deepEqual(parseEmbed(embedHtml), { author: "chef", caption: media.edge_media_to_caption.edges[0].node.text, image: media.display_url });
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
