import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i=0;i<Math.min(a.length,b.length);i++) {
    dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i];
  }
  const denom = Math.sqrt(na)*Math.sqrt(nb);
  return denom ? dot/denom : 0;
}

export async function embed(text: string) {
  const res = await openai.embeddings.create({
    input: text,
    model: "text-embedding-3-small"
  });
  return res.data[0].embedding;
}

/** Store banter if learning is enabled and user opted in */
export async function maybeStoreBanter(opts: {
  discordId: string, channelId: string, messageId: string, text: string, kept?: boolean
}) {
  const cfg = await prisma.config.findFirst({ where: { id: 1 } });
  if (!cfg?.allowLearn) return;

  const coach = await prisma.coach.findUnique({ where: { discordId: opts.discordId } });
  if (!coach) return;

  const cleaned = opts.text.strip?.() ?? opts.text;
  if (!cleaned || cleaned.length < 8) return;

  // crude profanity / toxicity filter before embedding (extend for your league)
  // Keep spicy but avoid obvious slurs here; extend blocklist as needed.
  const lower = cleaned.toLowerCase();
  const blocked = ["slur1","slur2","slur3"];
  if (blocked.some(s => lower.includes(s))) return;

  const vector = await embed(cleaned);
  await prisma.banterMessage.create({
    data: {
      coachId: coach.id,
      channelId: opts.channelId,
      messageId: opts.messageId,
      text: cleaned,
      kept: opts.kept ?? true,
      embedding: vector as unknown as any
    }
  });
}

export async function retrieveBanterForUsers(userIds: number[], k=6) {
  // Retrieve last 200 banter lines for these users, rank by similarity to a simple prompt vector
  const msgs = await prisma.banterMessage.findMany({
    where: { coachId: { in: userIds } },
    orderBy: { ts: "desc" },
    take: 200
  });

  if (!msgs.length) return [];

  const promptVec = await embed("EA College Football smack talk, inside jokes, catchphrases, play style.");
  const scored = msgs
    .map(m => ({
      text: m.text,
      score: cosine((m.embedding as unknown as number[]) || [], promptVec)
    }))
    .sort((a,b) => b.score - a.score)
    .slice(0,k)
    .map(x => x.text);

  return scored;
}
