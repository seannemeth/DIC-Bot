import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { computePower } from '../lib/power.js';

export async function startWebServer(prisma: PrismaClient) {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(cors());
  app.use(express.json());

  const pubDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(pubDir));

  app.get('/api/conferences', async (_req: Request, res: Response) => {
    res.json(['ACC','Big Ten','Big 12','Pac 12','SEC']);
  }); });

  app.get('/api/standings', async (req: Request, res: Response) => {
    try {
      const type = (req.query.type as string || 'overall').toLowerCase();
      const conf = (req.query.conference as string) || '';
      if (type === 'power') {
        const rows = await computePower(prisma);
        res.json({ type, rows });
        return;
      }
      const teams = await prisma.coach.findMany({ where: conf ? { conference: conf } : {} });
      const games = await prisma.game.findMany({ where: { status: 'confirmed' } });
      type Rec = { coachId:number, team:string, conf?:string|null, w:number,l:number,t:number,pf:number,pa:number,diff:number };
      const table: Rec[] = teams.map(t => ({ coachId: t.id, team: t.team || t.handle, conf: t.conference, w:0,l:0,t:0,pf:0,pa:0,diff:0 }));
      const lookup = new Map<number, Rec>(table.map(r => [r.coachId, r]));
      for (const g of games) {
        if (g.homePts == null || g.awayPts == null) continue;
        const h = lookup.get(g.homeCoachId);
        const a = lookup.get(g.awayCoachId);
        if (h) { h.pf += g.homePts; h.pa += g.awayPts; h.diff += (g.homePts - g.awayPts); }
        if (a) { a.pf += g.awayPts; a.pa += g.homePts; a.diff += (g.awayPts - g.homePts); }
        if (h && a) {
          if (g.homePts > g.awayPts) { h.w++; a.l++; }
          else if (g.homePts < g.awayPts) { a.w++; h.l++; }
          else { h.t++; a.t++; }
        }
      }
      const sorted = table.sort((x,y) => {
        const wx = x.w+x.l+x.t ? (x.w+0.5*x.t)/(x.w+x.l+x.t) : 0;
        const wy = y.w+y.l+y.t ? (y.w+0.5*y.t)/(y.w+y.l+y.t) : 0;
        if (wy !== wx) return wy - wx;
        if (y.diff !== x.diff) return y.diff - x.diff;
        return (y.pf - y.pa) - (x.pf - x.pa);
      }); });
      res.json({ type: 'overall', rows: sorted });
    } }).catch((e:any)=>{
      res.status(500).json({ error: (e as any).message });
    }
  }); });

  app.get('/api/power', async (_req: Request, res: Response) => {
    try {
      const rows = await computePower(prisma);
      res.json(rows);
    } }).catch((e:any)=>{
      res.status(500).json({ error: (e as any).message });
    }
  }); });

  app.get('/api/games/recent', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit || 25), 100);
      const games = await prisma.game.findMany({ where: { status: 'confirmed' }, orderBy: { playedAt: 'desc' }, take: limit });
      res.json(games);
    } }).catch((e:any)=>{
      res.status(500).json({ error: (e as any).message });
    }
  }); });

  app.get('/api/lines', async (req: Request, res: Response) => {
    try {
      const season = Number(req.query.season || 1);
      const week = Number(req.query.week || 1);
      const lines = await prisma.line.findMany({ where: { season, week }, orderBy: { id: 'desc' } });
      res.json(lines);
    } }).catch((e:any)=>{
      res.status(500).json({ error: (e as any).message });
    }
  }); });

  app.get('/api/wallets', async (_req: Request, res: Response) => {
    try {
      const wallets = await prisma.wallet.findMany({ orderBy: { balance: 'desc' }, take: 50, include: { coach: true } });
      res.json(wallets.map(w => ({ coachId: w.coachId, team: w.coach.team || w.coach.handle, balance: w.balance })));
    } }).catch((e:any)=>{
      res.status(500).json({ error: (e as any).message });
    }
  }); });

  app.get('/api/wallet/:coachId', async (req: Request, res: Response) => {
    try {
      const coachId = Number(req.params.coachId);
      const w = await prisma.wallet.findUnique({ where: { coachId }, include: { coach: true } });
      if (!w) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ coachId: w.coachId, team: w.coach.team || w.coach.handle, balance: w.balance });
    } }).catch((e:any)=>{
      res.status(500).json({ error: (e as any).message });
    }
  }); });

  app.get('/api/coaches', async (_req: Request, res: Response) => {
    try {
      const coaches = await prisma.coach.findMany();
      res.json(coaches);
    } }).catch((e:any)=>{
      res.status(500).json({ error: (e as any).message });
    }
  }); });

  app.get('/api/h2h', async (req: Request, res: Response) => {
    try {
      const aId = Number(req.query.a);
      const bId = Number(req.query.b);
      if (!aId || !bId) { res.status(400).json({ error: 'Params a,b required' }); return; }
      const games = await prisma.game.findMany({
        where: { status: 'confirmed', OR: [{ homeCoachId: aId, awayCoachId: bId }, { homeCoachId: bId, awayCoachId: aId }] },
        orderBy: { playedAt: 'desc' }
      }); });
      let aW=0,bW=0,ties=0, margins:number[]=[];
      for (const g of games) {
        if (g.homePts == null || g.awayPts == null) continue;
        const aHome = g.homeCoachId === aId;
        const aPts = aHome ? g.homePts : g.awayPts;
        const bPts = aHome ? g.awayPts : g.homePts;
        margins.push(aPts - bPts);
        if (aPts > bPts) aW++; else if (aPts < bPts) bW++; else ties++;
      }
      res.json({ aId, bId, aW, bW, ties, avgMargin: margins.length ? (margins.reduce((x,y)=>x+y,0)/margins.length) : 0, games });
    } }).catch((e:any)=>{
      res.status(500).json({ error: (e as any).message });
    }
  }); });

  app.listen(PORT, () => {
    console.log(`DIC dashboard: http://localhost:${PORT}`);
  }); });
}
