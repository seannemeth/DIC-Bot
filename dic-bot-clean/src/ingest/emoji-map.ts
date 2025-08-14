import { loadSheet } from "../lib/sheets";

export type EmojiMap = Record<string, string>;
let cache: EmojiMap = {};
let lastLoaded = 0;
const now = () => Date.now();

export async function loadEmojiMapFromSheet(): Promise<EmojiMap> {
  const doc = await loadSheet(process.env.GOOGLE_SHEET_ID!, process.env.GOOGLE_CLIENT_EMAIL!, process.env.GOOGLE_PRIVATE_KEY!);
  const sheet = (doc as any).sheetsByTitle?.["Emojis"];
  if (!sheet) throw new Error("No 'Emojis' tab found");
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const map: EmojiMap = {};
  for (const r of rows) {
    const id = String(r.get("EmojiId") || "").trim();
    const team = String(r.get("Team") || "").trim();
    if (id && team) map[id] = team;
  }
  cache = map; lastLoaded = now(); return map;
}
export async function getEmojiMap(ttlMs = 5*60*1000): Promise<EmojiMap> {
  if (!lastLoaded || now()-lastLoaded > ttlMs || Object.keys(cache).length===0) {
    try { await loadEmojiMapFromSheet(); } catch {}
  }
  return cache;
}
