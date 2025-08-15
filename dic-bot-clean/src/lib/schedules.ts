import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export type WeekSchedule = {
  games: any[];
  played: any[];
  remaining: any[];
};

function isPlayed(g: any) {
  return (g.homePts != null && g.awayPts != null) || g.status === 'confirmed';
}

export async function getWeekSchedule(season: number, week: number): Promise<WeekSchedule> {
  const games = await prisma.game.findMany({
    where: { season, week },
    orderBy: [{ homeTeam: 'asc' }, { awayTeam: 'asc' }],
  });

  const played = games.filter(isPlayed);
  const remaining = games.filter(g => !isPlayed(g));

  return { games, played, remaining };
}
