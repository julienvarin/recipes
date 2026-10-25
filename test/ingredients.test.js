import { test } from "node:test";
import assert from "node:assert/strict";
import { splitIngredient, normalizeIngredient, sortIngredients } from "../js/ingredients.js";

const split = (t) => Object.values(splitIngredient(t));

test("quantity and name are split, units shortened", () => {
  assert.deepEqual(split("4 cuillères à soupe de câpres"), ["4 càs", "Câpres"]);
  assert.deepEqual(split("1/2 cuillère à café de sel"), ["½ càc", "Sel"]);
  assert.deepEqual(split("2 c. à s. de miel"), ["2 càs", "Miel"]);
  assert.deepEqual(split("300g de lentilles cuites"), ["300 g", "Lentilles cuites"]);
  assert.deepEqual(split("4cl d’huile d’olive"), ["4 cl", "Huile d’olive"]);
  assert.deepEqual(split("1 bonne poignée de pistaches"), ["1 poignée", "Pistaches"]);
  assert.deepEqual(split("Quelques feuilles de basilic"), ["qq feuilles", "Basilic"]);
  assert.deepEqual(split("2 tablespoons olive oil"), ["2 tbsp", "Olive oil"]);
  assert.deepEqual(split("1 1/2 cups milk"), ["1½ cups", "Milk"]);
  assert.deepEqual(split("pinch of salt"), ["1 pinch", "Salt"]);
  assert.deepEqual(split("Feta 160g"), ["160 g", "Feta"]);
  assert.deepEqual(split("2 eggs"), ["2", "Eggs"]);
  assert.deepEqual(split("Sel, poivre"), ["", "Sel, poivre"]);
});

test("stored ingredients are normalised", () => {
  assert.deepEqual(normalizeIngredient({ text: "150g flour", group: "" }), { qty: "150 g", name: "Flour", group: "" });
  assert.deepEqual(normalizeIngredient({ qty: "200 grammes", name: "pois chiches" }), { qty: "200 g", name: "Pois chiches", group: "" });
});

test("sorted by kind then amount, groups kept together", () => {
  const list = ["1/2 càc de sel", "4 cl d'huile", "100 g de sucre", "200 g de farine", "3 oeufs", "500 g de poulet", "2 carottes"].map((t) => ({ ...splitIngredient(t), group: "" }));
  assert.deepEqual(sortIngredients(list).map((k) => k.ing.name), ["Poulet", "Carottes", "Farine", "Oeufs", "Sucre", "Huile", "Sel"]);
  const grouped = [{ qty: "1 càc", name: "Sel", group: "Pâte" }, { qty: "200 g", name: "Farine", group: "Pâte" }, { qty: "", name: "Basilic", group: "Sauce" }];
  assert.deepEqual(sortIngredients(grouped).map((k) => k.index), [1, 0, 2]);
});

test("blocks: base, rest, basics", async () => {
  const { blockOf } = await import("../js/ingredients.js");
  assert.deepEqual(["Poulet", "Carottes", "Riz", "Feta", "Sucre", "Huile d'olive", "Sel", "Basilic"].map(blockOf), [0, 0, 0, 1, 1, 2, 2, 2]);
});

test("salt, pepper and cooking oil are dropped unless measured into the dish", async () => {
  const { isStaple } = await import("../js/ingredients.js");
  const drop = (name, qty, course) => isStaple({ name, qty }, course);
  assert.equal(drop("Sel", "½ càc"), true);
  assert.equal(drop("Sel, poivre", ""), true);
  assert.equal(drop("Huile d’olive", "1 filet"), true);
  assert.equal(drop("Olive oil", ""), true);
  assert.equal(drop("Huile d’olive", "4 cl"), false); // part of the dressing
  assert.equal(drop("Sel", "10 g"), false); // weighed for bread
  assert.equal(drop("Sel", "1 pincée", "dessert"), false);
  assert.equal(drop("Huile de sésame", ""), false); // a flavour, not a staple
});
