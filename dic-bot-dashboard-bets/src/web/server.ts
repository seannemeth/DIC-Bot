import express from "express";
import cors from "cors";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { computePower } from "../lib/power.js";

export async function startWebServer(prisma: PrismaClient) {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(cors());
  app.use(express.json());

  // Static dashboard
  const pubDir = path.resolve(process.cwd(), "public");
  app.use(express.static(pubDir));

  // Helper: build overall standings
  async function buildStandings() {
    const teams = await prisma.coach.findMany();
    const games = await prisma.game.findMany({ where: { status: "confirmed" } });
    type Rec = { coachId:number, team:string, conf?:string|null, w:number, l:number, t:number, pf:number, pa:number, diff:number };
    const table: Rec[] = teams.map(t => ({ coachId:t.id, team:t.team||t.handle, conf:t.conference, w:0,l:0,t:0,pf:0,pa:0,diff:0 }));
    const lookup = new Map<number, Rec>(table.map(r => [r.coachId, r]));
    for (const g of games) {
      const h = lookup.get(g.homeCoachId)!;
      const a = lookup.get(g.awayCoachId)!;
      if (g.homePts === null || g.awayPts === null) continue;
      h.pf += g.homePts; h.pa += g.awayPts; h.diff += (g.homePts - g.awayPts);
      a.pf += g.awayPts; a.pa += g.homePts; a.diff += (g.awayPts - g.homePts);
      if (g.homePts > g.awayPts) { h.w++; a.l++; }
      else if (g.homePts < g.awayPts) { a.w++; h.l++; }
      else { h.t++; a.t++; }
    }
    return table.sort((x,y) => {
      const wx = x.w + x.l + x.t ? (x.w + 0.5*x.t) / (x.w + x.l + x.t) : 0;
      const wy = y.w + y.l + y.t ? (y.w + 0.5*y.t) / (y.w + y.l + y.t) : 0;
      if (wy !== wx) return wy - wx;
      if (y.diff !== x.diff) return y.diff - x.diff;
      return (y.pf - y.pa) - (x.pf - x.pa);
    });
  }

  app.get("/api/standings", async (req, res) => {
    try {
      const type = (req.query.type as string || "overall").toLowerCase();
      if (type === "power") {
        const rows = await computePower(prisma);
        res.json({ type, rows });
        return;
      }
      const rows = await buildStandings();
      res.json({ type: "overall", rows });
    } catch (e:any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/power", async (_req, res) => {
    try {
      const rows = await computePower(prisma);
      res.json(rows);
    } catch (e:any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/games/recent", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit || 25), 100);
      const games = await prisma.game.findMany({
        where: { status: "confirmed" },
        orderBy: { playedAt: "desc" },
        take: limit
      });
      res.json(games);
    } catch (e:any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/coaches", async (_req, res) => {
    try {
      const coaches = await prisma.coach.findMany();
      res.json(coaches);
    } catch (e:any) {
      res.status(500).json({ error: e.message });
    }
  });


  app.get("/api/lines", async (req, res) => {
    try {
      const season = Number(req.query.season || 1);
      const week = Number(req.query.week || 1);
      const lines = await prisma.line.findMany({
        where: { season, week },
        orderBy: { id: "desc" }
      });
      res.json(lines);
    } catch (e:any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/wallets", async (_req, res) => {
    try {
      const wallets = await prisma.wallet.findMany({ orderBy: { balance: "desc" }, take: 50, include: { coach: true } });
      res.json(wallets.map(w => ({ coachId: w.coachId, team: w.coach.team || w.coach.handle, balance: w.balance })));
    } catch (e:any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/wallet/:coachId", async (req, res) => {
    try {
      const coachId = Number(req.params.coachId);
      const w = await prisma.wallet.findUnique({ where: { coachId }, include: { coach: true } });
      if (!w) { res.status(404).json({ error: "Not found" }); return; }
      res.json({ coachId: w.coachId, team: w.coach.team || w.coach.handle, balance: w.balance });
    } catch (e:any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/h2h", async (req, res) => {
    try {
      const aId = Number(req.query.a);
      const bId = Number(req.query.b);
      if (!aId || !bId) { res.status(400).json({ error: "Params a,b required" }); return; }
      const games = await prisma.game.findMany({
        where: { status: "confirmed",
          OR: [{ homeCoachId: aId, awayCoachId: bId }, { homeCoachId: bId, awayCoachId: aId }]
        },
        orderBy: { playedAt: "desc" }
      });

      let aW=0,bW=0,ties=0, margins:number[] = [];
      for (const g of games) {
        if (g.homePts == null || g.awayPts == null) continue;
        const aHome = g.homeCoachId === aId;
        const aPts = aHome ? g.homePts : g.awayPts;
        const bPts = aHome ? g.awayPts : g.homePts;
        margins.push(aPts - bPts);
        if (aPts > bPts) aW++; else if (aPts < bPts) bW++; else ties++;
      }
      res.json({ aId, bId, aW, bW, ties, avgMargin: margins.length ? (margins.reduce((x,y)=>x+y,0)/margins.length) : 0, games });
    } catch (e:any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`DIC dashboard: http://localhost:${PORT}`);
  });
}
