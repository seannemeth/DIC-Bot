import { PrismaClient, Game, Line, Bet, Wallet } from "@prisma/client";

export function americanPayout(amount: number, price: number) {
  if (price === 0 || isNaN(price)) return 0;
  if (price > 0) return Math.floor(amount * (price / 100));
  return Math.floor(amount * (100 / Math.abs(price)));
}

export function settleSpread(homePts: number, awayPts: number, spread: number, side: "home"|"away") {
  // spread is from home perspective (negative = home favored)
  const margin = homePts - awayPts;
  const adj = side === "home" ? margin + spread : -margin + spread;
  if (adj > 0) return 1;     // win
  if (adj === 0) return 0.5; // push
  return 0;                  // loss
}

export function settleTotal(homePts: number, awayPts: number, total: number, side: "over"|"under") {
  const sum = homePts + awayPts;
  if (sum === total) return 0.5;
  if (side === "over") return sum > total ? 1 : 0;
  return sum < total ? 1 : 0;
}

export function settleML(homePts: number, awayPts: number, side: "home"|"away") {
  if (homePts === awayPts) return 0.5; // tie/push (rare)
  const homeWon = homePts > awayPts;
  if (side === "home") return homeWon ? 1 : 0;
  return homeWon ? 0 : 1;
}
