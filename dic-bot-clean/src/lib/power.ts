import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/** Options to tune the formula (no decay used). */
export type PowerOptions = {
  winPoints?: number;        // base for a win
  lossPoints?: number;       // base for a loss
  tiePoints?: number;        // base for a tie (if you allow)
  movFactor?: number;        // points per margin of victory
  movCap?: number;           // cap MOV contribution per game (absolute)
  oppFactor?: number;        // weight applied to opponent's previous rating
  iterations?: number;       // how many times to propagate opponent strength
  season?: number | null;    // filter: season
  maxWeek?: number | null;   // filter: up to week (inclusive)
};

/** Default tuning: balanced between W/L, MOV, and Opp Strength. */
const DEFAULTS: Required<PowerOptions> = {
  winPoints: 1.0,
  lossPoints: -1.0,
  tiePoints: 0.0,
  movFactor: 0.05,
  movCap: 28,
  oppFactor: 0.20,
  iterations: 20,
  season: null,
  maxWeek: null,
};

type CoachRow = { id: number; team: string | null; handle: string };
type GameRow = {
  id: number;
  season: number | null;
  week: number | null;
  homeCoachId: number;
  awayCoachId: number;
  homeTeam: string | null;
  awayTeam: string | null;
  homePts: number | null;
  awayPts: number | null;
  status: string;
};

export async function fetchInputs(opts?: Partial<PowerOptions>) {
  const o = { ...DEFAULTS, ...(opts || {}) };

  const [coaches, games] = await Promise.all([
    prisma.coach.findMany() as unknown as CoachRow[],
    prisma.game.findMany({
      where: {
        status: 'confirmed',
        ...(o.season != null ? { season: o.season } : {}),
        ...(o.maxWeek != null ? { week: { lte: o.maxWeek } } : {}),
      },
    }) as unknown as GameRow[],
  ]);

  return { coaches, games, options: o };
}

/** Compute power ratings. No decay; recursive opponent strength propagation. */
export function computePowerRatings(
  coaches: CoachRow[],
  games: GameRow[],
  options?: Partial<PowerOptions>
) {
  const o = { ...DEFAULTS, ...(options || {}) };

  // Index coaches
  const idToIdx = new Map<number, number>();
  const idxToId: number[] = [];
  const teams = coaches.map((c, i) => {
    idToIdx.set(c.id, i);
    idxToId[i] = c.id;
    return c.team || c.handle;
  });

  const n = coaches.length;
  // Initialize ratings
  let rating = new Array<number>(n).fill(0);

  // Precompute each team's game list for speed
  type TeamGame = {
    oppIdx: number;
    mov: number; // margin of victory from this team's POV
    base: number; // base win/loss/tie points
  };
  const schedule: TeamGame[][] = Array.from({ length: n }, () => []);

  for (const g of games) {
    if (g.homePts == null || g.awayPts == null) continue;
    const hi = idToIdx.get(g.homeCoachId);
    const ai = idToIdx.get(g.awayCoachId);
    if (hi == null || ai == null) continue;

    const hMov = g.homePts - g.awayPts;
    const aMov = -hMov;

    const hBase = g.homePts > g.awayPts ? o.winPoints : (g.homePts < g.awayPts ? o.lossPoints : o.tiePoints);
    const aBase = g.awayPts > g.homePts ? o.winPoints : (g.awayPts < g.homePts ? o.lossPoints : o.tiePoints);

    schedule[hi].push({ oppIdx: ai, mov: hMov, base: hBase });
    schedule[ai].push({ oppIdx: hi, mov: aMov, base: aBase });
  }

  // Iteratively propagate opponent strength
  for (let iter = 0; iter < o.iterations; iter++) {
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const gamesI = schedule[i];
      for (const g of gamesI) {
        const movClamped = Math.max(-o.movCap, Math.min(o.movCap, g.mov));
        s += g.base + o.movFactor * movClamped + o.oppFactor * rating[g.oppIdx];
      }
      // Optionally average by games played to prevent schedule-size advantage
      next[i] = gamesI.length > 0 ? s / gamesI.length : 0;
    }
    // Normalize (zero mean) to prevent drift
    const mean = next.reduce((a, b) => a + b, 0) / (n || 1);
    for (let i = 0; i < n; i++) next[i] = next[i] - mean;
    rating = next;
  }

  // Create result list
  const rows = coaches.map((c, i) => ({
    coachId: c.id,
    team: c.team || c.handle,
    rating: rating[i],
  }));

  // Sort desc by rating; tie-break with team name to keep order stable
  rows.sort((a, b) => (b.rating - a.rating) || a.team.localeCompare(b.team));
  return rows;
}

export async function computePowerRankings(opts?: Partial<PowerOptions>) {
  const { coaches, games, options } = await fetchInputs(opts);
  return computePowerRatings(coaches, games, options);
}
