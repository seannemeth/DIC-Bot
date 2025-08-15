// src/lib/schedules.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export type WeekSchedule = {
  games: any[];
  played: any[];
  remaining: any[];
};

export async function getWeekSchedule(season: number, week: number): Promise<WeekSchedule> {
  const games = await prisma.game.findMany({
    where: { season, week },
    orderBy: [{ homeTeam: 'asc' }, { awayTeam: 'asc' }],
  });

  const played = games.filter((g: any) => g.status === 'confirmed');
  const remaining = games.filter((g: any) => g.status === 'scheduled');

  return { games, played, remaining };
}
