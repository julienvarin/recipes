// Optional AI parsing with Claude Haiku. The API key is stored on this device only.

const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.132.1/+esm";
const MODEL = "claude-haiku-5-5";

export const COURSES = ["main", "starter", "dessert", "side", "breakfast", "snack", "drink", "sauce"];
export const TAGS = ["oven", "stovetop", "air-fryer", "no-cook", "resting", "freezer", "quick", "vegetarian", "vegan"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["has_recipe", "title", "language", "servings", "course", "tags", "ingredients", "steps"],
  properties: {
    has_recipe: { type: "boolean", description: "false if the caption contains no usable recipe" },
    title: { type: "string" },
    language: { type: "string", enum: ["en", "fr"] },
    servings: { type: "string", description: 'e.g. "4 personnes", "2 servings", or ""' },
    course: { type: "string", enum: [...COURSES, ""] },
    tags: { type: "array", items: { type: "string", enum: TAGS } },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["qty", "name", "group"],
        properties: {
          qty: { type: "string", description: 'amount with a short unit, e.g. "300 g", "½ càs", "2", or ""' },
          name: { type: "string", description: 'ingredient, capitalised, without "de"/"of", e.g. "Lentilles cuites"' },
          group: { type: "string", description: 'sub-list name such as "Sauce", or ""' },
        },
      },
    },
    steps: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM = `You turn an Instagram recipe caption into a quick-reference recipe card for someone cooking.

Rules:
- Write in the caption's language: a French caption gives a French card, an English caption an English card. Never translate.
- title: short dish name, no emojis.
- ingredients: one item each, concise, no emojis. Keep every ingredient. qty uses short units: g, kg, ml, cl, L, càs (cuillère à soupe), càc (cuillère à café), pincée for French; g, ml, tbsp, tsp, cup, pinch for English; fractions as ½ ¼ ¾. Use group only when the caption splits ingredients into parts (dough, sauce...).
- steps: short, simple, imperative steps that are easy to follow while cooking. Usually 4-10 steps, one or two actions each, at most ~25 words. Keep every quantity, temperature and duration exactly (write durations like "35 min", "1 h"). Drop chit-chat, promotions, hashtags and emojis.
- course: the kind of dish, or "" if unclear.
- tags: only those clearly supported by the recipe ("resting" = any resting, chilling, marinating or rising time; "quick" = about 20 minutes or less in total).
- If the caption has no real recipe (for example the recipe is only in the video), set has_recipe to false and leave the lists empty.`;

let clientPromise;
async function getClient(apiKey) {
  if (!clientPromise || clientPromise.key !== apiKey) {
    clientPromise = import(SDK_URL).then(({ default: Anthropic }) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true }));
    clientPromise.key = apiKey;
  }
  return clientPromise;
}

export async function aiParse(caption, apiKey) {
  const client = await getClient(apiKey);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: `Caption:\n\n${caption}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined this caption");
  if (response.stop_reason === "max_tokens") throw new Error("The AI answer was cut off");
  const block = response.content.find((b) => b.type === "text");
  const data = JSON.parse(block.text);
  return {
    title: data.title,
    lang: data.language,
    servings: data.servings,
    course: data.course,
    tags: data.tags,
    ingredients: data.ingredients,
    steps: data.steps,
    noRecipe: !data.has_recipe || data.ingredients.length < 2,
  };
}
