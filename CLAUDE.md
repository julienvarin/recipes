# Recipes

Static PWA served by GitHub Pages from `main` (root). Cloudflare Worker in `worker/` (deployed from `wrangler.jsonc`).

- Run `npm test` before pushing. Serve locally with `npm start` (port 8080).
- Bump `CACHE` in `sw.js` when shipping changed app files.
- Any UI change: follow `DESIGN.md` and check the result against its "Tells to keep out" list
  (screenshots in light and dark mode at phone width) before pushing.
