// Free, rule-based recipe extraction from an Instagram caption.
// Good enough for captions that already list ingredients then steps;
// the optional AI parser (ai.js) does a cleaner job.

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const BULLET = /^[-–—•*·▪◦●○✔✓☐→>]+\s*/;

// Word match that also works with accented letters (JS \b does not).
const kw = (words) => new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])`, "iu");

const UNIT =
  "g|gr|grammes?|kg|mg|ml|cl|dl|l|litres?|oz|lbs?|cups?|tasses?|tbsp|tbs|tsp|c\\.?\\s?à\\.?\\s?[sc]\\.?|cas|cac|cs|cc|cuill[eè]res?|cuill?\\.?|pinc[ée]es?|pinch(?:es)?|verres?|sachets?|gousses?|cloves?|tranches?|slices?|bottes?|bunch|poign[ée]es?|handfuls?|cans?|bo[iî]tes?|pi[eè]ces?|pieces?|morceaux?|feuilles?|leaves|branches?|brins?|sprigs?|knobs?|noix|noisettes?|sticks?|pots?|dash|filets?";
const QTY_LINE = new RegExp(
  `^(?:\\d|[½¼¾⅓⅔⅛]|(?:une?|deux|trois|quatre|cinq|six|sept|huit|dix|a|an|one|two|three|four|five|six|half|quelques|some|a few|zest[e]?|le zeste|le jus|juice|sel|salt|poivre|pepper|huile|oil)(?![\\p{L}]))`,
  "iu"
);
const HAS_UNIT = new RegExp(`\\d\\s*(?:${UNIT})(?![\\p{L}])`, "iu");
const NUMBERED = /^(?:\d{1,2}\s*[.)/-]\s+|(?:étape|etape|step)\s*\d+\s*[:.)-]?\s*)/i;
const VERB = kw(
  "préchauffe[rz]?|prechauffe[rz]?|mélange[rz]?|melange[rz]?|ajoute[rz]?|fai(?:tes|s|re)|verse[rz]?|coupe[rz]?|épluche[rz]?|mette[zr]|mets|laisse[rz]?|enfourne[rz]?|cuire|faites cuire|servez|sers|dépose[rz]?|émince[rz]?|hache[rz]?|fouette[rz]?|incorpore[rz]?|répartis|répartissez|égoutte[rz]?|réserve[rz]?|retire[rz]?|assaisonne[rz]?|place[rz]?|étale[rz]?|dans un|dans une|pendant|preheat|mix|add|cook|bake|pour|cut|chop|slice|stir|place|let|combine|whisk|heat|serve|bring|boil|simmer|season|spread|transfer|remove|drain|blend|fold|roll|top|garnish|in a|in the|meanwhile|then|once"
);
const ING_HEADER = /^(?:les\s+)?(?:ingr[ée]dients?|ingredients?|you(?:'|’)?ll need|what you need|liste de courses|shopping list)\b\s*(?:\([^)]*\))?\s*:?\s*/i;
const STEP_HEADER = /^(?:la\s+)?(?:pr[ée]paration|recette|instructions?|method|methode|méthode|directions|steps|étapes|etapes|how to make it|how to|déroulé)\b\s*:?\s*/i;
const SERVINGS = /(?:pour|for|serves|makes|recette pour)\s+(\d+(?:\s*(?:-|à|to)\s*\d+)?)\s*(personnes?|pers\.?|parts?|people|servings?|portions?|persons?|enfants?|pi[eè]ces?)?|(\d+)\s*(?:servings?|portions?|personnes|parts)/i;
const PROMO = /(link in (?:my )?bio|lien en bio|abonne|follow (?:me|for)|enregistre|save (?:this|it|for later)|share (?:this|with)|partage(?:z)? (?:cette|la|avec)|tag (?:a|your)|identifie|commente|comment ["“]?[a-z]+|code promo|promo code|#ad|sponsoris|partenariat|en collab)/i;

export function detectLang(text) {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}' ]+/gu, " ")} `;
  const count = (words) => words.reduce((n, w) => n + t.split(` ${w} `).length - 1, 0);
  const fr = count(["de", "la", "le", "les", "et", "des", "du", "pour", "avec", "une", "un", "dans", "sel", "sucre", "beurre", "farine", "puis", "au", "aux", "à"]);
  const en = count(["the", "and", "with", "of", "to", "for", "add", "cup", "cups", "tbsp", "tsp", "salt", "sugar", "butter", "flour", "then", "in", "into", "until"]);
  const accents = (text.match(/[éèàùçêâîôû]/g) || []).length;
  return fr + accents / 4 > en ? "fr" : "en";
}

function clean(line) {
  return line.replace(EMOJI, "").replace(/\s+/g, " ").trim();
}

function isIngredientLike(line) {
  if (!line || line.length > 90 || NUMBERED.test(line)) return false;
  if (/[.!?]\s+\p{Lu}/u.test(line)) return false; // several sentences -> a step
  const body = line.replace(BULLET, "");
  if (VERB.test(body.split(" ").slice(0, 2).join(" ")) && !QTY_LINE.test(body)) return false;
  return BULLET.test(line) || QTY_LINE.test(body) || HAS_UNIT.test(body);
}

function isStepLike(line) {
  return NUMBERED.test(line) || line.length > 70 || VERB.test(line.split(" ").slice(0, 2).join(" "));
}

function splitList(text) {
  return text
    .split(/\s*[,;]\s*|\s+[-–•]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitSentences(paragraph) {
  const parts = paragraph.split(/(?<=[.!?])\s+(?=[\p{Lu}\d])/u).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (out.length && p.length < 28) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

function buildSteps(lines) {
  const steps = [];
  if (lines.some((l) => NUMBERED.test(l))) {
    for (const l of lines) {
      if (!l) continue;
      if (NUMBERED.test(l) || !steps.length) steps.push(l.replace(NUMBERED, "").replace(BULLET, ""));
      else steps[steps.length - 1] += " " + l.replace(BULLET, "");
    }
    return steps;
  }
  // Paragraphs separated by blank lines, then sentences.
  let para = [];
  const flush = () => {
    if (para.length) steps.push(...splitSentences(para.join(" ")));
    para = [];
  };
  for (const l of lines) {
    if (!l) flush();
    else if (BULLET.test(l)) {
      flush();
      steps.push(l.replace(BULLET, ""));
    } else para.push(l);
  }
  flush();
  return steps;
}

export function detectCourseAndTags(text, ingredientCount) {
  const t = text.toLowerCase();
  let course = "";
  if (kw("dessert|desserts|gâteau|gateau|cake|cookies?|brownies?|crumble|mousse au chocolat|tiramisu|cheesecake|muffins?|crêpes?|crepes?|pancakes?|glace|ice cream|biscuits?|fondant|madeleines?|financiers?|cupcakes?|cinnamon rolls?|banana bread|tarte (?:aux|au) (?:pommes|fraises|citron|poires|chocolat)|pâte à tartiner|caramel|meringue|panna cotta|flan").test(t)) course = "dessert";
  else if (kw("petit[- ]déjeuner|breakfast|brunch|porridge|granola|overnight oats").test(t)) course = "breakfast";
  else if (kw("entrée|entree|starter|appetizer|apéro|apero|apéritif|(?<!à )soupe|soup|velouté|veloute|dip|houmous|hummus|bruschetta|tapas").test(t)) course = "starter";
  else if (kw("plat principal|dinner|dîner|diner|lunch|main|poulet|chicken|bœuf|boeuf|beef|pâtes|pates|pasta|risotto|curry|saumon|salmon|porc|pork|burger|pizza|gratin|lasagnes?|lasagna|steak|tofu|riz|rice|tacos?|bowl").test(t)) course = "main";

  const tags = [];
  if (/(?<![\p{L}])(four|oven|enfourne|enfournez|bake|baking|baked|th\.?\s?\d)(?![\p{L}])|\d\s?°\s?[cf]/iu.test(t)) tags.push("oven");
  if (kw("poêle|poele|casserole|sauteuse|wok|faire revenir|faites revenir|rissoler|mijoter|frying pan|skillet|saucepan|pot|simmer|sauté|saute|stir-fry|bring to a boil|portez à ébullition").test(t)) tags.push("stovetop");
  if (kw("repos|reposer|laisse[rz]? reposer|frigo|réfrigérateur|refrigerate|refrigerator|fridge|overnight|toute la nuit|une nuit|chill|chilling|let (?:it )?rest|rest for|resting|mariner|marinate|marinade|laisse[rz]? lever|laisser pousser|rise|proof|prove").test(t)) tags.push("resting");
  if (kw("congélateur|congelateur|freezer|freeze|congeler").test(t)) tags.push("freezer");
  const cooks = kw("four|oven|cuire|cuisson|poêle|poele|casserole|bouillir|faire revenir|revenir|rissoler|cook|cooking|fry|fried|boil|simmer|roast|roasted|rôti|rôties|bake|grill|griller|micro-ondes|microwave|sauté|saute|air ?fryer|wok|plancha|mijoter").test(t);
  if (!cooks && ingredientCount >= 2) tags.push("no-cook");
  return { course, tags };
}

export function parseCaption(raw) {
  const text = String(raw || "").replace(/\r/g, "");
  const lines = text
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .split("\n")
    .map(clean);

  // Title: first meaningful line.
  let i = 0;
  while (i < lines.length && !lines[i]) i++;
  let title = lines[i] || "";
  if (isIngredientLike(title) || ING_HEADER.test(title)) title = "";
  else i++;
  if (title.length > 70) title = title.split(/[.!?:|]/)[0].slice(0, 70).trim();
  title = title.replace(/[:\-–|]+$/, "").trim();

  let servings = "";
  const ts = title.match(SERVINGS);
  if (ts) {
    servings = ts[1] ? `${ts[1]}${ts[2] ? " " + ts[2] : ""}` : `${ts[3]}`;
    title = title.replace(/\s*\(([^)]*)\)/, (m, inner) => (SERVINGS.test(inner) ? "" : m)).trim();
  }
  const ingredients = [];
  const stepLines = [];
  let mode = "auto"; // auto | ing | steps
  let group = "";
  let sawIngredient = false;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      if (mode === "steps") stepLines.push("");
      continue;
    }
    if (PROMO.test(line) && line.length < 140) continue;

    if (!servings && mode !== "steps" && line.length < 60) {
      const s = line.match(SERVINGS);
      if (s && !HAS_UNIT.test(line)) {
        servings = s[1] ? `${s[1]}${s[2] ? " " + s[2] : ""}` : `${s[3]}`;
        continue;
      }
    }

    if (ING_HEADER.test(line)) {
      mode = "ing";
      const rest = line.replace(ING_HEADER, "");
      if (rest) for (const item of splitList(rest)) ingredients.push({ text: item, group });
      if (rest) sawIngredient = true;
      continue;
    }
    if (STEP_HEADER.test(line) && line.replace(STEP_HEADER, "").length < 60) {
      mode = "steps";
      const rest = line.replace(STEP_HEADER, "");
      if (rest) stepLines.push(rest);
      continue;
    }

    if (mode !== "steps") {
      // "Pour la sauce :" / "For the dough:" sub-headers
      if (line.endsWith(":") && line.length < 45 && !HAS_UNIT.test(line)) {
        group = line.replace(/:$/, "").replace(BULLET, "").trim();
        mode = mode === "auto" ? "ing" : mode;
        continue;
      }
      if (isIngredientLike(line) || (mode === "ing" && !isStepLike(line))) {
        ingredients.push({ text: line.replace(BULLET, ""), group });
        sawIngredient = true;
        continue;
      }
      // A short bare item right after the list ("Parmesan", "Basil")
      if (sawIngredient && line.length <= 30 && !isStepLike(line) && !/[.!?]$/.test(line)) {
        ingredients.push({ text: line.replace(BULLET, ""), group });
        continue;
      }
      if (sawIngredient || isStepLike(line)) mode = "steps";
      else continue; // intro text before the ingredients
    }
    stepLines.push(line);
  }

  const steps = buildSteps(stepLines).filter((s) => s.length > 2 && !PROMO.test(s));
  const { course, tags } = detectCourseAndTags(text, ingredients.length);

  return {
    title: title || "Untitled recipe",
    lang: detectLang(text),
    servings,
    course,
    tags,
    ingredients,
    steps,
    noRecipe: ingredients.length < 2,
  };
}

// ---- Durations inside a step, for the timer chips ----

const DURATION =
  /(\d+(?:[.,]\d+)?)\s*(?:(?:-|–|à|a|to|ou|or)\s*(\d+(?:[.,]\d+)?)\s*)?(heures?|hours?|hrs?|h|minutes?|mins?|min|mn|secondes?|seconds?|secs?)(?:\s*(\d{1,2})(?![\d\p{L}°]))?(?![\p{L}])/giu;

export function findDurations(text) {
  const out = [];
  for (const m of text.matchAll(DURATION)) {
    const n = parseFloat(m[1].replace(",", "."));
    const unit = m[3].toLowerCase();
    let seconds;
    if (unit.startsWith("h")) seconds = n * 3600 + (m[4] ? +m[4] * 60 : 0);
    else if (unit.startsWith("s")) seconds = n;
    else seconds = n * 60;
    if (seconds >= 5 && seconds <= 48 * 3600) {
      out.push({ index: m.index, length: m[0].length, seconds: Math.round(seconds), label: m[0].trim() });
    }
  }
  return out;
}
