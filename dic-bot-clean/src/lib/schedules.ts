import { PrismaClient, Game } from '@prisma/client';
const prisma = new PrismaClient();

export type WeekSchedule = {
  games: Game[];
  played: Game[];
  remaining: Game[];
};

export async function getWeekSchedule(season: number, week: number): Promise<WeekSchedule> {
  const games: Game[] = await prisma.game.findMany({
    where: { season, week },
    orderBy: [{ homeTeam: 'asc' }, { awayTeam: 'asc' }],
  });

  const played: Game[] = games.filter((g: Game) => g.status === 'confirmed');
  const remaining: Game[] = games.filter((g: Game) => g.status === 'scheduled');

  return { games, played, remaining };
}
