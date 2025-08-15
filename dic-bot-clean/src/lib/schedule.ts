// src/lib/schedule.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function getWeekSchedule(season: number, week: number) {
  const games = await prisma.game.findMany({
    where: { season, week },
    orderBy: [{ homeTeam: 'asc' }, { awayTeam: 'asc' }],
  });

  const played = games.filter(g => g.status === 'confirmed');
  const remaining = games.filter(g => g.status === 'scheduled');

  return { games, played, remaining };
}
