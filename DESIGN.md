# Design

A kitchen tool: read from arm's length, with wet hands, at a glance.
Keep it plain, precise and calm. The photo is the only decoration.

## System

- **Colour.** Neutral canvas (`#fff` / `#0b0b0c`) and ink text. One accent, herb green, which
  only means *done* (ticked ingredient, finished step, timer finished). Primary actions are ink, not accent.
- **Text.** Secondary text uses `--text-2` (≥ 6:1 contrast). `--text-3` is for placeholders and
  ticked items only. Reading text is 17px; nothing below 14px.
- **Type.** System font (SF on iPhone). Weights 400/500/600, 700 for titles only.
  Letter-spacing no tighter than −0.01em. Sentence case everywhere.
- **Shape.** Radius 8 (controls), 12 (images, panels), 16 (sheet tops). Full pills only for chips and tags.
- **Depth.** Flat. Lists are rows with hairline dividers, never cards inside cards.
  Shadows only on things that float (the + button, timer bar, buttons over the photo).
- **Copy.** Say what a control does in as few words as possible. No subtitles under titles,
  no helper text that repeats a label, no labels repeated within one view. Typographic apostrophes (’).

## Tells to keep out

Checked before every UI change. If a change brings one of these back, fix it before shipping.

- Warm cream background with a terracotta or orange accent
- Low-contrast gray body text; gray text on tinted backgrounds
- Small tracked UPPERCASE gray labels or eyebrows above content
- Subtitles or explainer lines under headings; headline + gray paragraph empty states
- Heavy 800 headings with crushed letter-spacing
- Same large radius and soft shadow on everything; cards nested in cards; stacks of identical cards
- Glassmorphism, backdrop blur, glows, gradients, gradient text, overlays on photos
- Dashed "add" boxes and placeholder shapes (big letters, blobs) standing in for images
- Pulsing or bouncing animation on things that aren't changing
- `A · B · C` meta strings, `→`/`↗` on links, ✨ sparkle icons for AI features
- The same action shown twice on one screen
