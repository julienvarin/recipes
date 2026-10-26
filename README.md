# Recipes

Quick-reference recipe cards from Instagram reels, as a phone web app.

- Paste a reel link: the caption becomes a card with the cover picture, a tappable ingredient checklist and tappable steps.
- Cards keep the recipe's language (English or French).
- Tags (main, dessert, oven, resting…) for filtering, plus search across titles and ingredients.
- Durations in steps (“35 min”) are timer buttons.
- Reset a card's checklist for the next time you cook it.
- Works offline once loaded, and keeps the screen awake while a recipe is open.
- Recipes are stored on your device and, with sync on, on your Worker, so every phone and computer shows
  the same collection. **Settings → Export** makes a backup file.

## How it works

```
phone (GitHub Pages app) ──► Cloudflare Worker ──► instagram.com embed page
        │                       (caption, author, cover image)
        │               └──(optional)──► Cloudflare KV: synced recipes
        └──(optional)──► Claude Haiku API: cleans up the recipe, simplifies steps, adds tags
                          (directly with a key on the device, or through the Worker's key)
```

GitHub Pages only serves static files, and browsers can't read Instagram directly, so a tiny free
[Cloudflare Worker](worker/worker.js) does the fetching. Without an API key, a free rule-based reader
([js/parse.js](js/parse.js)) turns the caption into a recipe; with one, Claude Haiku does it more cleanly.

Reels whose recipe is only spoken in the video (not in the caption) are flagged “No recipe text”.
You can add the text by hand.

## Setup

1. **Worker.** In the Cloudflare dashboard, go to Workers & Pages → Create → Import a repository, then pick this repo.
   Use the project name `recipes` (it matches `wrangler.jsonc`), leave the build command empty and keep
   `npx wrangler deploy`. After that, every push to `main` redeploys the Worker automatically. Its URL is
   `https://recipes.<your-subdomain>.workers.dev`.
   If the app is not served from `https://julienvarin.github.io`, add your address to `ALLOWED_ORIGINS`.
2. **App.** In the GitHub repo, go to Settings → Pages → Build and deployment. Choose Source “Deploy from a branch”,
   then `main` and `/ (root)`. Every push to `main` republishes `https://julienvarin.github.io/recipes/`.
3. **Phone.** Open the app. On iPhone, open it in Safari and tap Share → *Add to Home Screen*;
   on Android, use Chrome → *Install app*. Then open **Settings** in the app and paste the Worker URL.
4. **Optional AI.** Create an API key at [console.anthropic.com](https://console.anthropic.com).
   It's pay-as-you-go, separate from a Claude Pro subscription, so set a spend limit. Paste the key in Settings.
   The key stays on your phone and is never in this repo. Haiku costs well under a cent per recipe.

5. **Sync across devices (optional).** In the Cloudflare dashboard, open the `recipes` Worker → Settings →
   Variables and Secrets, and add two secrets:
   - `SYNC_TOKEN`: a long passphrase you make up (keep it in your password manager).
   - `ANTHROPIC_API_KEY`: your API key, so no device needs its own (optional).

   The `RECIPES` KV storage is created by the first deploy after this change. If that deploy fails on it,
   create a KV namespace under Storage & Databases → KV and put its id in `wrangler.jsonc`
   (`{ "binding": "RECIPES", "id": "…" }`).

   On each device, open **Settings** and enter the Worker URL and the sync passphrase. Then
   recipes, edits, checklists and deletions sync whenever the app opens or changes. If two devices
   change the same recipe, the most recent change wins. Leave the API key field empty to use the Worker's key.
   On iPhone, do this in the home-screen app: it keeps its own storage, separate from Safari.

On Android, the installed app also shows up in Instagram's **Share** menu.

## Develop

```sh
npm start   # serves the app on http://localhost:8080
npm test    # parser + worker tests (Node 20+)
```
