// Ingredient helpers: split "300g de lentilles" into { qty: "300 g", name: "Lentilles" },
// shorten units (cuillère à soupe -> càs), and sort a list by type and importance.

const FRACTIONS = { "1/2": "½", "1/4": "¼", "3/4": "¾", "1/3": "⅓", "2/3": "⅔", "1/8": "⅛" };
const NUM_WORDS = {
  un: "1", une: "1", a: "1", an: "1", one: "1", deux: "2", two: "2", trois: "3", three: "3", quatre: "4", four: "4",
  cinq: "5", five: "5", six: "6", sept: "7", seven: "7", huit: "8", eight: "8", dix: "10", ten: "10", douze: "12", twelve: "12",
  demi: "½", "demie": "½", half: "½", quelques: "qq", "a few": "a few", some: "some", "un peu": "un peu", "a little": "a little",
};

// [pattern, short form]. A null short form keeps the word as written (lower-cased).
const UNITS = [
  ["cuill?(?:è|e)res?\\s+(?:à|a)\\s+soupe|cuill?\\.?\\s*(?:à|a)\\s*s\\.?|c\\.?\\s?(?:à|a)\\.?\\s?s\\.?|càs|cas|cs", "càs"],
  ["cuill?(?:è|e)res?\\s+(?:à|a)\\s+(?:café|cafe|thé|the)|cuill?\\.?\\s*(?:à|a)\\s*c\\.?|c\\.?\\s?(?:à|a)\\.?\\s?c\\.?|càc|cac|cc", "càc"],
  ["tablespoons?|tbsps?|tbs", "tbsp"],
  ["teaspoons?|tsps?", "tsp"],
  ["kilogrammes?|kilograms?|kilos?|kgs?", "kg"],
  ["grammes?|grams?|gr|g", "g"],
  ["centilitres?|centiliters?|cl", "cl"],
  ["millilitres?|milliliters?|ml", "ml"],
  ["décilitres?|decilitres?|dl", "dl"],
  ["litres?|liters?|l", "L"],
  ["ounces?|oz", "oz"],
  ["pounds?|lbs?", "lb"],
  ["cups?|tasses?|verres?|pincées?|pincees?|pinch(?:es)?|sachets?|gousses?|cloves?|tranches?|slices?|bottes?|bunch(?:es)?|poignées?|poignees?|handfuls?|cans?|boîtes?|boites?|filets?|brins?|sprigs?|feuilles?|leaves|morceaux?|pieces?|knobs?|noix|pots?|dash(?:es)?|traits?|branches?|zestes?|jus", null],
];
const UNIT_RE = new RegExp(`^(${UNITS.map(([p]) => p).join("|")})(?![\\p{L}])\\.?\\s*`, "iu");
const NUM_RE = /^(?:environ\s+|about\s+|~\s*)?(\d+\s+\d\/\d|\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|\d*\s*[½¼¾⅓⅔⅛])(?:\s*(?:-|–|à|to)\s*(\d+(?:[.,]\d+)?))?\s*/iu;
const WORD_RE = new RegExp(`^(${Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}])\\s*`, "iu");
const LINK_RE = /^(?:de\s+|d['’]\s*|des\s+|du\s+|of\s+)/iu;
const ADJ_RE = /^(?:bonne|bon|grosse|gros|petite|petit|belle|beau|grande|grand|large|small|big|heaped|heaping|generous|good)\s+/iu;
const ARTICLE_RE = /^(?:le|la|les|l['’]|the)\s*/iu;
const TRAILING_QTY_RE = /^(.+?)[\s,:–-]*\(?\s*(\d+(?:[.,]\d+)?\s*(?:kg|g|cl|ml|dl|l|oz|lb|càs|càc|tbsp|tsp|cups?))\s*\)?$/iu;

function fraction(n) {
  const mixed = n.match(/^(\d+)\s+(\d\/\d)$/);
  if (mixed) return mixed[1] + (FRACTIONS[mixed[2]] || "/" + mixed[2]);
  const f = n.replace(/\s/g, "");
  return FRACTIONS[f] || f.replace(/^(\d+)([½¼¾⅓⅔⅛])$/, "$1$2");
}

function shortUnit(word) {
  for (const [p, short] of UNITS) if (new RegExp(`^(?:${p})$`, "iu").test(word.replace(/\.$/, ""))) return short || word.toLowerCase();
  return word.toLowerCase();
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "4cl d’huile d’olive" -> { qty: "4 cl", name: "Huile d’olive" } */
export function splitIngredient(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  let rest = raw;
  let num = "";
  let m = rest.match(NUM_RE);
  if (m && m[1].trim()) {
    num = fraction(m[1].trim()) + (m[2] ? `-${m[2]}` : "");
    rest = rest.slice(m[0].length);
  } else if ((m = rest.match(WORD_RE))) {
    num = NUM_WORDS[m[1].toLowerCase()];
    rest = rest.slice(m[0].length);
  }
  let unit = "";
  const adj = rest.match(ADJ_RE);
  const afterAdj = adj ? rest.slice(adj[0].length) : rest;
  if (num && (m = rest.match(UNIT_RE) || afterAdj.match(UNIT_RE))) {
    unit = shortUnit(m[1]);
    rest = (rest.match(UNIT_RE) ? rest : afterAdj).slice(m[0].length);
  } else if (!num && (m = rest.match(UNIT_RE)) && LINK_RE.test(rest.slice(m[0].length))) {
    num = "1"; // "pinch of salt"
    unit = shortUnit(m[1]);
    rest = rest.slice(m[0].length);
  }
  if (num) rest = rest.replace(LINK_RE, "");
  let qty = [num, unit].filter(Boolean).join(" ");

  if (!qty) {
    const t = raw.match(TRAILING_QTY_RE);
    if (t) {
      const inner = splitIngredient(`${t[2]} x`);
      if (inner.qty) {
        qty = inner.qty;
        rest = t[1];
      }
    }
    rest = rest.replace(ARTICLE_RE, "");
  }
  rest = rest.replace(/^[,:\s-]+/, "").trim();
  if (!rest) return { qty: "", name: capitalize(raw) };
  return { qty, name: capitalize(rest) };
}

/** Normalise a stored ingredient (old ones only have `text`). */
export function normalizeIngredient(ing) {
  if (ing.name != null) {
    const qty = ing.qty ? splitIngredient(`${ing.qty} x`).qty || ing.qty : "";
    return { qty, name: capitalize(String(ing.name).trim()), group: ing.group || "" };
  }
  return { ...splitIngredient(ing.text), group: ing.group || "" };
}

// ---- Sorting ----

const plain = (s) => s.toLowerCase().replace(/œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (list) => new RegExp(`\\b(?:${list})(?:s|es|x)?\\b`);

// Checked in this order; the first match gives the rank (lower = more important).
const KINDS = [
  [7, words("sel|salt|poivre|pepper|black pepper|paprika|cumin|curry|curcuma|turmeric|cannelle|cinnamon|piment|chili|chilli|herbes?|herbs|basilic|basil|persil|parsley|coriandre|cilantro|thym|thyme|romarin|rosemary|zaatar|za'atar|origan|oregano|ciboulette|chives|menthe|mint|aneth|dill|zeste|zest|muscade|nutmeg|gingembre|ginger|laurier|bay lea|sumac|cardamome|cardamom|vanille|vanilla|fleur de sel|piment d'espelette|garam masala|ras el hanout|herbes de provence|epices|spices|levure|yeast|baking powder|baking soda|bicarbonate")],
  [6, words("huile|oil|vinaigre|vinegar|sauce soja|soy sauce|sauce|moutarde|mustard|bouillon|stock|broth|vin|wine|eau|water|jus|juice|ketchup|mayonnaise|mayo|pesto|tahini|harissa|sriracha|nuoc mam|fish sauce")],
  [0, words("poulet|chicken|boeuf|beef|porc|pork|agneau|lamb|veau|veal|saumon|salmon|thon|tuna|crevette|shrimp|prawn|cabillaud|cod|poisson|fish|lardon|bacon|jambon|ham|chorizo|saucisse|sausage|tofu|tempeh|steak|dinde|turkey|canard|duck|viande|meat|hache|mince|merguez|moules|mussels|calamar|squid|seitan")],
  [1, words("bell pepper|red pepper|green pepper|yellow pepper|poivron|carotte|carrot|tomate|tomato|oignon|onion|echalote|shallot|ail|garlic|courgette|zucchini|aubergine|eggplant|pomme de terre|potato|patate|sweet potato|epinard|spinach|champignon|mushroom|brocoli|broccoli|chou|cabbage|kale|salade|lettuce|roquette|arugula|concombre|cucumber|avocat|avocado|courge|squash|butternut|potiron|pumpkin|poireau|leek|celeri|celery|fenouil|fennel|asperge|asparagus|haricots verts|green beans|petits pois|peas|mais|corn|radis|radish|betterave|beet|citron|lemon|lime|orange|pomme|apple|banane|banana|fraise|strawberr|framboise|raspberr|myrtille|blueberr|poire|pear|mangue|mango|ananas|pineapple|peche|peach|abricot|apricot|cerise|cherr|raisin|grape|fruits? rouges|berries|fruit|legume|vegetable|gingembre frais")],
  [2, words("pates|pasta|spaghetti|penne|tagliatelle|fusilli|lasagne|riz|rice|lentille|lentil|pois chiche|chickpea|haricot|bean|quinoa|semoule|couscous|boulgour|bulgur|farine|flour|pain|bread|pate feuilletee|pate brisee|pate sablee|puff pastry|pastry|dough|flocons d'avoine|avoine|oats|oat|nouille|noodle|tortilla|wrap|gnocchi|polenta|maizena|cornstarch|chapelure|breadcrumbs|biscuit|cracker")],
  [3, words("beurre|butter|lait|milk|creme|cream|fromage|cheese|feta|parmesan|mozzarella|burrata|chevre|goat cheese|ricotta|mascarpone|yaourt|yogurt|yoghurt|skyr|comte|emmental|gruyere|cheddar|oeuf|egg|jaune|yolk|blanc d'oeuf|egg white")],
  [5, words("sucre|sugar|cassonade|miel|honey|sirop|syrup|chocolat|chocolate|cacao|cocoa|amande|almond|noisette|hazelnut|noix|walnut|nut|pistache|pistachio|cacahuete|peanut|cajou|cashew|graine|seed|sesame|chia|capre|caper|olive|raisins secs|raisins|cranberr|dattes?|date|confiture|jam|pate a tartiner|coco|coconut")],
];

export function kindRank(name) {
  const n = plain(name);
  for (const [rank, re] of KINDS) if (re.test(n)) return rank;
  return 4;
}

const GRAMS = { g: 1, kg: 1000, ml: 1, cl: 10, dl: 100, L: 1000, oz: 28, lb: 450, càs: 15, tbsp: 15, càc: 5, tsp: 5 };
const WORD_GRAMS = [[/cup|tasse|verre/, 220], [/pinc|pinch|dash|trait/, 0.5], [/gousse|clove/, 5], [/botte|bunch/, 250], [/poign|handful/, 30], [/feuille|lea|brin|sprig|branche/, 1], [/tranche|slice/, 30], [/bo[iî]te|can|pot/, 400], [/sachet/, 10], [/zeste|jus/, 5], [/noix|knob/, 10], [/morceau|piece/, 50], [/filet/, 150]];

export function estimateGrams(qty) {
  if (!qty) return 0;
  const [n, ...unitParts] = qty.split(" ");
  const unit = unitParts.join(" ");
  const amount = n === "qq" ? 3 : parseFloat(n.replace(",", ".").replace("½", ".5").replace("¼", ".25").replace("¾", ".75").replace(/^\./, "0.")) || 1;
  if (GRAMS[unit]) return amount * GRAMS[unit];
  for (const [re, g] of WORD_GRAMS) if (re.test(unit)) return amount * g;
  return amount * 100; // "2 eggs", "1 onion"
}

/** Sort by kind, then by estimated amount (largest first), keeping ingredient groups together. */
export function sortIngredients(list) {
  const groups = [...new Set(list.map((i) => i.group || ""))];
  const keyed = list.map((ing, index) => ({ ing, index, rank: kindRank(ing.name), grams: estimateGrams(ing.qty) }));
  return groups.flatMap((g) =>
    keyed
      .filter((k) => (k.ing.group || "") === g)
      .sort((a, b) => a.rank - b.rank || b.grams - a.grams || a.index - b.index)
  );
}

/** Visual block for the checklist: 0 = the base (protein, veg, starch), 1 = the rest, 2 = basics (liquids, seasoning). */
export function blockOf(name) {
  const rank = kindRank(name);
  return rank <= 2 ? 0 : rank <= 5 ? 1 : 2;
}

// ---- Pantry staples ----
// Salt, pepper and cooking oil are always at home, so they are left off the list unless
// they are a measured part of the dish (a dressing, sauce, dough or batter).

const STAPLE_SALT_PEPPER = /^(?:(?:gros |fleur de |fine )?sel|salt|sea salt|kosher salt|poivre(?: noir)?|black pepper|pepper|sel(?:,| et) poivre|salt(?:,| and| &) pepper|sel & poivre)(?:\s+(?:du moulin|fraîchement moulu|freshly ground|to taste|au goût|selon votre goût))?$/i;
const STAPLE_OIL = /^(?:huile(?: d['’]olive| neutre| végétale| de tournesol| de colza)?|(?:extra virgin |vegetable |neutral |sunflower |canola )?(?:olive )?oil|cooking oil)$/i;
const MEASURED = /^\S+\s+(?:g|kg|ml|cl|dl|L|càs|càc|tbsp|tsp|cups?|oz)$/;

export function isStaple(ing, course = "") {
  const name = String(ing.name || "").replace(/\s+/g, " ").trim();
  if (STAPLE_SALT_PEPPER.test(name)) {
    // Weighed salt matters in baking and doughs; a pinch to season does not.
    return !(/\d\s*g$/.test(ing.qty || "") || ((course === "dessert" || course === "breakfast") && ing.qty));
  }
  if (STAPLE_OIL.test(name)) return !MEASURED.test(ing.qty || "");
  return false;
}
