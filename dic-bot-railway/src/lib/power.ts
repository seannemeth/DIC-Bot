import { PrismaClient, Game } from "@prisma/client";
import { updateElo } from "./elo.js";
export type PowerRow = { coachId:number, team:string, elo:number, sos:number, form:number, composite:number };
export async function computePower(prisma = new PrismaClient()): Promise<PowerRow[]> {
  const coaches = await prisma.coach.findMany();
  const games = await prisma.game.findMany({ where: { status:"confirmed" }, orderBy: { playedAt:"asc" } });
  const elo: Record<number, number> = {}; coaches.forEach(c=>elo[c.id]=1500);
  for (const g of games) {
    if (g.homePts==null || g.awayPts==null) continue;
    const a=g.homeCoachId, b=g.awayCoachId;
    const aWin = g.homePts>g.awayPts?1: g.homePts<g.awayPts?0:0.5;
    const k = Math.abs(g.homePts-g.awayPts)>=14?28:20;
    const [na, nb] = updateElo(elo[a], elo[b], aWin as 0|0.5|1, k);
    elo[a]=na; elo[b]=nb;
  }
  const byCoach: Record<number, Game[]> = {}; coaches.forEach(c=>byCoach[c.id]=[]);
  for (const g of games) { byCoach[g.homeCoachId].push(g); byCoach[g.awayCoachId].push(g); }
  function recentN(id:number,n=3){ return byCoach[id].filter(g=>g.homePts!=null&&g.awayPts!=null).sort((a,b)=>b.playedAt!.getTime()-a.playedAt!.getTime()).slice(0,n); }
  const sos: Record<number, number> = {};
  for (const c of coaches) {
    const rec = byCoach[c.id].filter(g=>g.homePts!=null&&g.awayPts!=null);
    if (!rec.length){ sos[c.id]=1500; continue; }
    const last3 = new Set(recentN(c.id,3).map(g=>g.id));
    let sum=0, cnt=0;
    for (const g of rec) {
      const opp = g.homeCoachId===c.id? g.awayCoachId : g.homeCoachId;
      const w = last3.has(g.id)?1.25:1;
      sum += elo[opp]*w; cnt+=w;
    }
    sos[c.id] = cnt? sum/cnt : 1500;
  }
  const form: Record<number, number> = {};
  for (const c of coaches) {
    let score=0;
    for (const g of recentN(c.id,3)) {
      const meHome = g.homeCoachId===c.id;
      const my = meHome? g.homePts!: g.awayPts!;
      const them = meHome? g.awayPts!: g.homePts!;
      const diff = my-them;
      if (diff>0) score+=15;
      else if (diff<=-14) score-=10;
      else if (diff>=-7) score+=5;
    }
    form[c.id]=score;
  }
  const rows: PowerRow[] = coaches.map(c=>({ coachId:c.id, team:c.team||c.handle, elo:elo[c.id], sos:sos[c.id], form:form[c.id], composite:0 }));
  const norm = (vals:number[]) => { const min=Math.min(...vals), max=Math.max(...vals); return vals.map(v=> max===min?50: (100*(v-min)/(max-min))); };
  const eloN = norm(rows.map(r=>r.elo)), sosN = norm(rows.map(r=>r.sos)), formN = norm(rows.map(r=>r.form));
  rows.forEach((r,i)=>{ r.composite = Math.round(eloN[i] + 0.35*sosN[i] + formN[i]); });
  const compN = norm(rows.map(r=>r.composite)); rows.forEach((r,i)=> r.composite = Math.round(compN[i]));
  return rows.sort((a,b)=>b.composite-a.composite);
}
