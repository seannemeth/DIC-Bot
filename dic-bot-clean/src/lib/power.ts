import { PrismaClient } from '@prisma/client';

export type PowerRow = { coachId:number, team:string, w:number, l:number, t:number, pf:number, pa:number, diff:number, elo:number, composite:number };

function expected(a: number, b: number) { return 1/(1+Math.pow(10,(b-a)/400)); }

export async function computePower(prisma: PrismaClient): Promise<PowerRow[]> {
  const coaches = await prisma.coach.findMany();
  const games = await prisma.game.findMany({ where: { status:"confirmed" }, orderBy: { playedAt:"asc" } });
  const baseElo = 1500;
  const elo: Record<number, number> = {}; coaches.forEach((c:any)=>elo[c.id]=baseElo);

  type Rec = { id:number, team:string, w:number,l:number,t:number,pf:number,pa:number,diff:number };
  const rec: Record<number, Rec> = {};
  coaches.forEach((c:any)=> rec[c.id] = { id:c.id, team:c.team || c.handle, w:0,l:0,t:0,pf:0,pa:0,diff:0 });

  for (const g of games) {
    if (g.homePts==null || g.awayPts==null) continue;
    const h = g.homeCoachId, a = g.awayCoachId;
    const homeWin = g.homePts>g.awayPts ? 1 : g.homePts<g.awayPts ? 0 : 0.5;
    const margin = Math.abs(g.homePts - g.awayPts);
    const k = Math.min(20 + margin * 0.6, 40);
    const eh = expected(elo[h], elo[a]);
    const ea = expected(elo[a], elo[h]);
    elo[h] = elo[h] + k * ((homeWin as number) - eh);
    elo[a] = elo[a] + k * ((1 - (homeWin as number)) - ea);
    const H = rec[h], A = rec[a];
    H.pf += g.homePts; H.pa += g.awayPts; H.diff += g.homePts - g.awayPts;
    A.pf += g.awayPts; A.pa += g.homePts; A.diff += g.awayPts - g.homePts;
    if (g.homePts > g.awayPts) { H.w++; A.l++; }
    else if (g.homePts < g.awayPts) { A.w++; H.l++; }
    else { H.t++; A.t++; }
  }

  const rows: PowerRow[] = Object.values(rec).map(r => ({
    coachId: r.id, team: r.team, w:r.w, l:r.l, t:r.t, pf:r.pf, pa:r.pa, diff:r.diff, elo: elo[r.id] || baseElo, composite: 0
  }));
  const eloVals = rows.map(r=>r.elo);
  const diffVals = rows.map(r=>r.diff);
  const n = (vals:number[]) => { const min=Math.min(...vals), max=Math.max(...vals); return vals.map(v => max===min?50: (100*(v-min)/(max-min))); };
  const eloN = n(eloVals), diffN = n(diffVals);
  rows.forEach((r,i)=> r.composite = Math.round(0.7*eloN[i] + 0.3*diffN[i]));
  rows.sort((a,b)=> b.composite - a.composite);
  return rows;
}
