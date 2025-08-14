import { PrismaClient } from "@prisma/client";

type PowerRow = { coachId:number, team:string, elo:number, sos:number, form:number, composite:number };

function expected(a: number, b: number) { return 1/(1+Math.pow(10,(b-a)/400)); }
function updateElo(a: number, b: number, scoreA: 0|0.5|1, k=20) {
  const ea = expected(a,b), eb = expected(b,a);
  return [a + k*(scoreA-ea), b + k*((1-scoreA)-eb)];
}

export async function computePower(prisma = new PrismaClient()): Promise<PowerRow[]> {
  const coaches = await prisma.coach.findMany();
  const games = await prisma.game.findMany({ where: { status:"confirmed" }, orderBy: { playedAt:"asc" } });
  const elo: Record<number, number> = {}; coaches.forEach((c: any)=>elo[c.id]=1500);
  for (const g of games) {
    if (g.homePts==null || g.awayPts==null) continue;
    const a=g.homeCoachId, b=g.awayCoachId;
    const aWin = g.homePts>g.awayPts?1: g.homePts<g.awayPts?0:0.5;
    const k = Math.abs(g.homePts-g.awayPts)>=14?28:20;
    const [na, nb] = updateElo(elo[a], elo[b], aWin as 0|0.5|1, k);
    elo[a]=na; elo[b]=nb;
  }
  const byCoach: Record<number, number[]> = {}; coaches.forEach((c: any)=>byCoach[c.id]=[]);
  for (const g of games) {
    byCoach[g.homeCoachId].push(g.awayCoachId);
    byCoach[g.awayCoachId].push(g.homeCoachId);
  }
  const sos: Record<number, number> = {};
  for (const c of coaches) {
    const opps = byCoach[c.id];
    sos[c.id] = opps.length ? opps.reduce((s,oid)=>s+(elo[oid]||1500),0)/opps.length : 1500;
  }
  const form: Record<number, number> = {};
  for (const c of coaches) form[c.id]=0;
  const rows: PowerRow[] = coaches.map((c: any)=>({ coachId:c.id, team:c.team||c.handle, elo:elo[c.id], sos:sos[c.id], form:form[c.id], composite:0 }));
  const norm = (vals:number[]) => { const min=Math.min(...vals), max=Math.max(...vals); return vals.map(v=> max===min?50: (100*(v-min)/(max-min))); };
  const eloN = norm(rows.map(r=>r.elo)), sosN = norm(rows.map(r=>r.sos)), formN = norm(rows.map(r=>r.form));
  rows.forEach((r,i)=>{ r.composite = Math.round(eloN[i] + 0.35*sosN[i] + formN[i]); });
  const compN = norm(rows.map(r=>r.composite)); rows.forEach((r,i)=> r.composite = Math.round(compN[i]));
  return rows.sort((a,b)=>b.composite-a.composite);
}
