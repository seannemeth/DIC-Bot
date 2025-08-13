import OpenAI from "openai";

export type Spice = "pg" | "pg13" | "r";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function sanitize(text: string) {
  // Hard blocklist for slurs/identity-hate—replace with asterisks
  const blocked = /(\b(?:slur1|slur2|slur3)\b)/ig; // placeholder; extend for your league
  return text.replace(blocked, "***");
}

export function spiceGuidance(level: Spice) {
  if (level === "pg") return "Keep it PG; no profanity; playful, family-friendly banter.";
  if (level === "pg13") return "PG-13: allow some light profanity and cheeky innuendo. No explicit sexual content, no slurs, no identity-based insults.";
  return "R-rated: competitive smack talk, adult innuendo permitted; avoid explicit sexual descriptions, no slurs, no identity-based insults, keep it about gameplay and decisions.";
}

export async function generateRecap(opts: {
  facts: any,
  lore: string,
  banter: string[],
  spice: Spice
}) {
  const sys = `You are the DIC Insider—snappy ESPN-style writer. ${spiceGuidance(opts.spice)} Stay factual to provided JSON facts.`;
  const user = [
    "FACTS JSON:", "```json", JSON.stringify(opts.facts), "```",
    "LORE:", opts.lore || "None",
    "TOP BANTER LINES:", ...opts.banter.map(b => `• ${b}`),
    "TASK: 150–220 word recap with 1 headline, 3 turning-point bullets, and a punchy sign-off. Do not invent stats."
  ].join("\n");

  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [{role:"system", content:sys}, {role:"user", content:user}],
    temperature: 0.8,
    max_tokens: 400
  });

  return sanitize(res.choices[0].message.content || "");
}

export async function generatePreview(opts: {
  matchup: any,
  lore: string,
  banter: string[],
  spice: Spice
}) {
  const sys = `You are the DIC Insider—hype previewer. ${spiceGuidance(opts.spice)} Keep it playful and competitive.`;
  const user = [
    "MATCHUP JSON:", "```json", JSON.stringify(opts.matchup), "```",
    "LORE:", opts.lore || "None",
    "TOP BANTER LINES:", ...opts.banter.map(b => `• ${b}`),
    "TASK: 120–180 word preview with fake Vegas line, 2 keys to victory per team, and a 0–100 confidence meter."
  ].join("\n");

  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [{role:"system", content:sys}, {role:"user", content:user}],
    temperature: 0.8,
    max_tokens: 350
  });

  return sanitize(res.choices[0].message.content || "");
}

export async function generateRoast(opts: {
  targetHandle: string,
  context: string,
  banter: string[],
  spice: Spice
}) {
  const sys = `You are the DIC Insider—a roast comic. ${spiceGuidance(opts.spice)} Keep it to 1–2 punchlines, gameplay-focused.`;
  const user = [
    `TARGET: ${opts.targetHandle}`,
    "CONTEXT:", opts.context,
    "BANTER:", ...opts.banter.map(b => `• ${b}`),
    "TASK: 1–2 line roast."
  ].join("\n");

  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [{role:"system", content:sys}, {role:"user", content:user}],
    temperature: 0.9,
    max_tokens: 100
  });

  return sanitize(res.choices[0].message.content || "");
}
