// src/lib/schedules.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Infer your Game row type from the query result
type GameRow = Awaited<ReturnType<typeof prisma.game.findMany>>[number];

export type WeekSchedule = {
  games: GameRow[];
  played: GameRow[];
  remaining: GameRow[];
};

function isPlayed(g: GameRow): boolean {
  return (g.homePts != null && g.awayPts != null) || g.status === 'confirmed';
}

export async function getWeekSchedule(season: number, week: number): Promise<WeekSchedule> {
  const games = await prisma.game.findMany({
    where: { season, week },
    orderBy: [{ homeTeam: 'asc' }, { awayTeam: 'asc' }],
  });

  const played = games.filter(isPlayed);
  const remaining = games.filter((g: GameRow) => !isPlayed(g));

  return { games, played, remaining };
}
