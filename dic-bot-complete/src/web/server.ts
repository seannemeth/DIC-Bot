import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { computePower } from "../lib/power";

type Row = {
  coachId: number;
  team: string;
  conf?: string | null;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  diff: number;
};

function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
}

export async function startWebServer(prisma: PrismaClient) {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(cors());
  app.use(express.json());

  const pubDir = path.resolve(process.cwd(), "public");
  app.use(express.static(pubDir));

  async function buildStandings(conference?: string): Promise<Row[]> {
    const teams = await prisma.coach.findMany({
      where: conference ? { conference } : {},
    });
    const games = await prisma.game.findMany({
      where: { status: "confirmed" },
    });

    const table: Row[] = teams.map((t) => ({
      coachId: t.id,
      team: t.team || t.handle,
      conf: t.conference,
      w: 0,
      l: 0,
      t: 0,
      pf: 0,
      pa: 0,
      diff: 0,
    }));
    const lookup = new Map<number, Row>(table.map((r) => [r.coachId, r]));

    for (const g of games) {
      if (g.homePts == null || g.awayPts == null) continue;
      const h = lookup.get(g.homeCoachId);
      const a = lookup.get(g.awayCoachId);
      if (h) {
        h.pf += g.homePts;
        h.pa += g.awayPts;
        h.diff += g.homePts - g.awayPts;
      }
      if (a) {
        a.pf += g.awayPts;
        a.pa += g.homePts;
        a.diff += g.awayPts - g.homePts;
      }
      if (h && a) {
        if (g.homePts > g.awayPts) h.w++, a.l++;
        else if (g.homePts < g.awayPts) a.w++, h.l++;
        else h.t++, a.t++;
      }
    }

    return table.sort((x, y) => {
      const wx = x.w + x.l + x.t ? (x.w + 0.5 * x.t) / (x.w + x.l + x.t) : 0;
      const wy = y.w + y.l + y.t ? (y.w + 0.5 * y.t) / (y.w + y.l + y.t) : 0;
      if (wy !== wx) return wy - wx;
      if (y.diff !== x.diff) return y.diff - x.diff;
      return y.pf - y.pa - (x.pf - x.pa);
    });
  }

  app.get(
    "/api/conferences",
    wrap(async (_req: Request, res: Response) => {
      res.json(["ACC", "Big Ten", "Big 12", "Pac 12", "SEC"]);
    })
  );

  app.get(
    "/api/standings",
    wrap(async (req: Request, res: Response) => {
      const type = String(req.query.type || "overall").toLowerCase();
      const conf = (req.query.conference as string) || "";

      if (type === "power") {
        const rows = await computePower(prisma);
        res.json({ type, rows });
        return;
      }

      const rows = await buildStandings(conf || undefined);
      res.json({ type: "overall", rows });
    })
  );

  app.get(
    "/api/power",
    wrap(async (_req: Request, res: Response) => {
      const rows = await computePower(prisma);
      res.json(rows);
    })
  );

  app.get(
    "/api/games/recent",
    wrap(async (req: Request, res: Response) => {
      const limit = Math.min(Number(req.query.limit || 25), 100);
      const games = await prisma.game.findMany({
        where: { status: "confirmed" },
        orderBy: { playedAt: "desc" },
        take: limit,
      });
      res.json(games);
    })
  );

  app.get(
    "/api/lines",
    wrap(async (req: Request, res: Response) => {
      const season = Number(req.query.season || 1);
      const week = Number(req.query.week || 1);
      const lines = await prisma.line.findMany({
        where: { season, week },
        orderBy: { id: "desc" },
      });
      res.json(lines);
    })
  );

  app.get(
    "/api/wallets",
    wrap(async (_req: Request, res: Response) => {
      const wallets = await prisma.wallet.findMany({
        orderBy: { balance: "desc" },
        take: 50,
        include: { coach: true },
      });
      res.json(
        wallets.map((w) => ({
          coachId: w.coachId,
          team: w.coach.team || w.coach.handle,
          balance: w.balance,
        }))
      );
    })
  );

  app.get(
    "/api/wallet/:coachId",
    wrap(async (req: Request, res: Response) => {
      const coachId = Number(req.params.coachId);
      const w = await prisma.wallet.findUnique({
        where: { coachId },
        include: { coach: true },
      });
      if (!w) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({
        coachId: w.coachId,
        team: w.coach.team || w.coach.handle,
        balance: w.balance,
      });
    })
  );

  app.listen(PORT, () => {
    console.log(`DIC dashboard: http://localhost:${PORT}`);
  });
}
