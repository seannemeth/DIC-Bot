import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function getNumber(key: string): Promise<number | null> {
  const row = await prisma.meta.findUnique({ where: { key } });
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

export async function setNumber(key: string, value: number) {
  await prisma.meta.upsert({
    where: { key },
    create: { key, value: String(value) },
    update: { value: String(value) },
  });
}

export async function getCurrentSeasonWeek() {
  const season = (await getNumber('currentSeason')) ?? null;
  const week = (await getNumber('currentWeek')) ?? null;
  return { season, week };
}
