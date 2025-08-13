import { PrismaClient, Game, Coach } from "@prisma/client";
import { updateElo } from "./elo.js";

export type PowerRow = {
  coachId: number;
  team: string;
  elo: number;
  sos: number;
  form: number;
  composite: number;
};

export async function computePower(prisma = new PrismaClient()): Promise<PowerRow[]> {
  const coaches = await prisma.coach.findMany();
  const games = await prisma.game.findMany({ where: { status: "confirmed" }, orderBy: { playedAt: "asc" } });

  const elo: Record<number, number> = {};
  coaches.forEach(c => elo[c.id] = 1500);

  // chronological Elo
  for (const g of games) {
    if (g.homePts == null || g.awayPts == null) continue;
    const a = g.homeCoachId, b = g.awayCoachId;
    const aWin = g.homePts > g.awayPts ? 1 : (g.homePts < g.awayPts ? 0 : 0.5);
    const k = Math.abs(g.homePts - g.awayPts) >= 14 ? 28 : 20;
    const [newA, newB] = updateElo(elo[a], elo[b], aWin as 0|0.5|1, k);
    elo[a] = newA; elo[b] = newB;
  }

  // Build recent games per coach for SOS & form
  const byCoach: Record<number, Game[]> = {};
  coaches.forEach(c => byCoach[c.id] = []);
  for (const g of games) {
    byCoach[g.homeCoachId].push(g);
    byCoach[g.awayCoachId].push(g);
  }

  function recentN(coachId: number, n=3) {
    const arr = byCoach[coachId].filter(g => g.homePts != null && g.awayPts != null)
      .sort((a,b)=> (b.playedAt!.getTime() - a.playedAt!.getTime()));
    return arr.slice(0,n);
  }

  // SOS: avg opponent Elo, weight last 3 x1.25
  const sos: Record<number, number> = {};
  for (const c of coaches) {
    const rec = byCoach[c.id].filter(g => g.homePts != null && g.awayPts != null);
    if (!rec.length) { sos[c.id] = 1500; continue; }
    const last3 = recentN(c.id, 3);
    const last3Ids = new Set(last3.map(g => g.id));
    let sum = 0, cnt = 0;
    for (const g of rec) {
      const opp = g.homeCoachId === c.id ? g.awayCoachId : g.homeCoachId;
      const w = last3Ids.has(g.id) ? 1.25 : 1.0;
      sum += elo[opp] * w; cnt += w;
    }
    sos[c.id] = cnt ? sum / cnt : 1500;
  }

  // Form: last 3 → +15 win, +5 close loss (<=7), -10 blowout loss (>=14)
  const form: Record<number, number> = {};
  for (const c of coaches) {
    let score = 0;
    for (const g of recentN(c.id, 3)) {
      const meHome = g.homeCoachId === c.id;
      const my = meHome ? g.homePts! : g.awayPts!;
      const them = meHome ? g.awayPts! : g.homePts!;
      const diff = my - them;
      if (diff > 0) score += 15;
      else if (diff <= -14) score -= 10;
      else if (diff >= -7) score += 5;
    }
    form[c.id] = score;
  }

  // Normalize to 0-100 composite
  const rows: PowerRow[] = coaches.map(c => ({
    coachId: c.id,
    team: c.team || c.handle,
    elo: elo[c.id],
    sos: sos[c.id],
    form: form[c.id],
    composite: 0
  }));

  function norm(vals: number[]) {
    const min = Math.min(...vals), max = Math.max(...vals);
    return vals.map(v => max === min ? 50 : (100 * (v - min) / (max - min)));
  }

  const eloN = norm(rows.map(r => r.elo));
  const sosN = norm(rows.map(r => r.sos));
  const formN = norm(rows.map(r => r.form));

  rows.forEach((r,i) => {
    r.composite = Math.round(eloN[i] + 0.35 * sosN[i] + formN[i]);
  });

  // Re-normalize composite to 0-100
  const compN = norm(rows.map(r => r.composite));
  rows.forEach((r,i) => r.composite = Math.round(compN[i]));

  return rows.sort((a,b)=> b.composite - a.composite);
}
