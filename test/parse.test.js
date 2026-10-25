import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCaption, findDurations, detectLang } from "../js/parse.js";

const FR = `Tarte fine aux tomates 🍅

Pour 4 personnes

1 pâte feuilletée
4 tomates
2 cuillères à soupe de moutarde
100g de chèvre
Quelques brins de thym
Sel, poivre

Préchauffez le four à 200°C. Étalez la pâte sur une plaque. Badigeonnez de moutarde. Disposez les tomates en rondelles et le chèvre. Enfournez 25 min. Laissez reposer 5 min avant de servir.

#tarte #recettefacile`;

const EN = `Overnight oats 3 ways (serves 2)

Ingredients:
- 1 cup oats
- 1 cup milk
- 2 tbsp chia seeds
- 1 tbsp maple syrup

1. Mix everything in a jar.
2. Refrigerate overnight.
3. Top with fruit and enjoy!

Save this for later 💛 Follow for more`;

test("french caption: title, servings, ingredients, steps", () => {
  const r = parseCaption(FR);
  assert.equal(r.title, "Tarte fine aux tomates");
  assert.equal(r.lang, "fr");
  assert.equal(r.servings, "4 personnes");
  assert.equal(r.ingredients.length, 6);
  assert.equal(r.ingredients.at(-1).text, "Sel, poivre");
  assert.equal(r.steps[0], "Préchauffez le four à 200°C.");
  assert.ok(r.steps.some((s) => s.includes("25 min")));
  assert.ok(r.tags.includes("oven"));
  assert.ok(r.tags.includes("resting"));
  assert.equal(r.noRecipe, false);
});

test("english caption with headers, bullets, numbered steps and promo", () => {
  const r = parseCaption(EN);
  assert.equal(r.title, "Overnight oats 3 ways");
  assert.equal(r.lang, "en");
  assert.equal(r.servings, "2");
  assert.deepEqual(r.ingredients.map((i) => i.text), ["1 cup oats", "1 cup milk", "2 tbsp chia seeds", "1 tbsp maple syrup"]);
  assert.deepEqual(r.steps, ["Mix everything in a jar.", "Refrigerate overnight.", "Top with fruit and enjoy!"]);
  assert.equal(r.course, "breakfast");
  assert.ok(r.tags.includes("no-cook"));
});

test("ingredient groups", () => {
  const r = parseCaption(`Pancakes\n\nPour la pâte :\n200g de farine\n2 oeufs\n\nPour la garniture :\n100g de fruits rouges\n\nMélangez la farine et les oeufs. Faites cuire 2 min de chaque côté.`);
  assert.deepEqual(r.ingredients.map((i) => i.group), ["Pour la pâte", "Pour la pâte", "Pour la garniture"]);
  assert.equal(r.course, "dessert");
});

test("caption without a recipe is flagged", () => {
  const r = parseCaption("Sunset dinner with friends 🌅 #paris #food");
  assert.equal(r.noRecipe, true);
});

test("durations become timers", () => {
  const sec = (t) => findDurations(t).map((d) => d.seconds);
  assert.deepEqual(sec("Enfournez 35 min environ."), [2100]);
  assert.deepEqual(sec("Simmer 1h30, then rest 10 minutes."), [5400, 600]);
  assert.deepEqual(sec("Bake 10-12 min"), [600]);
  assert.deepEqual(sec("Laissez reposer 2 heures"), [7200]);
  assert.deepEqual(sec("4 cuillères à soupe, 190°C, 300g"), []);
});

test("language detection", () => {
  assert.equal(detectLang("Ajoutez le sucre et mélangez avec la farine"), "fr");
  assert.equal(detectLang("Add the sugar and mix with the flour"), "en");
});
