import { PrismaClient } from "@prisma/client";

export async function settleBetsForGame(prisma: PrismaClient, gameId: number) {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.homePts == null || game.awayPts == null) return;
  const bets = await prisma.bet.findMany({ where: { gameId, status: "open" } });
  for (const b of bets) {
    let result: "won"|"lost"|"push" = "push";
    if (b.market === "ml") {
      const homeWon = game.homePts > game.awayPts;
      const pickHome = b.side === "home";
      result = homeWon === pickHome ? "won" : (game.homePts === game.awayPts ? "push" : "lost");
    } else if (b.market === "spread" && b.line != null) {
      const margin = game.homePts - game.awayPts;
      if (b.side === "home") {
        if (margin > b.line) result = "won";
        else if (margin === b.line) result = "push";
        else result = "lost";
      } else if (b.side === "away") {
        if (-margin > -b.line) result = "won";
        else if (margin === b.line) result = "push";
        else result = "lost";
      }
    } else if (b.market === "total" && b.line != null) {
      const total = game.homePts + game.awayPts;
      if (b.side === "over") result = total > b.line ? "won" : (total === b.line ? "push" : "lost");
      else result = total < b.line ? "won" : (total === b.line ? "push" : "lost");
    }
    let payout = 0;
    if (result === "won") payout = b.amount * 2;
    else if (result === "push") payout = b.amount;
    await prisma.bet.update({ where: { id: b.id }, data: { status: result, payout, settledAt: new Date() } });
    if (payout > 0) await prisma.wallet.update({ where: { coachId: b.coachId }, data: { balance: { increment: payout } } });
  }
}
