import { PrismaClient } from '@prisma/client';
import { openSheetByTitle } from './googleAuth';

const prisma = new PrismaClient();

type LineRow = {
  GameId?: string;
  Season?: string | number;
  Week?: string | number;
  HomeTeam?: string;
  AwayTeam?: string;
  Spread?: string | number;
  SpreadOdds?: string | number;
  Total?: string | number;
  TotalOdds?: string | number;
  HomeML?: string | number;
  AwayML?: string | number;
  Cutoff?: string;
};

function toNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

/** Convert American odds to multiplier of the stake (returns total payout incl. stake). */
function payoutTotal(stake: number, americanOdds: number): number {
  if (americanOdds > 0) return stake * (1 + americanOdds / 100);
  return stake * (1 + 100 / Math.abs(americanOdds));
}

async function readLinesRow(season: number, week: number, homeTeam: string, awayTeam: string) {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const linesSheet = await openSheetByTitle(sheetId, 'Lines');
  const rows: any[] = await linesSheet.getRows();

  const match = rows.find(r =>
    String(r.Season ?? '') == String(season) &&
    String(r.Week ?? '') == String(week) &&
    String((r.HomeTeam ?? '')).trim() === homeTeam &&
    String((r.AwayTeam ?? '')).trim() === awayTeam
  );

  if (!match) return null;

  const row: LineRow = {
    GameId: match.GameId ? String(match.GameId) : undefined,
    Season: match.Season,
    Week: match.Week,
    HomeTeam: match.HomeTeam,
    AwayTeam: match.AwayTeam,
    Spread: match.Spread,
    SpreadOdds: match.SpreadOdds,
    Total: match.Total,
    TotalOdds: match.TotalOdds,
    HomeML: match.HomeML,
    AwayML: match.AwayML,
    Cutoff: match.Cutoff,
  };
  return row;
}

/** Grade a single wager given final points and line row. Returns {result, payout}. */
function gradeWager(
  market: 'SPREAD'|'TOTAL'|'ML',
  selection: 'HOME'|'AWAY'|'OVER'|'UNDER',
  homePts: number,
  awayPts: number,
  line: LineRow,
  stake: number
): { result: 'WIN'|'LOSS'|'PUSH', payout: number } {
  const spread = toNum(line.Spread);
  const spreadOdds = toNum(line.SpreadOdds) ?? -110;
  const total = toNum(line.Total);
  const totalOdds = toNum(line.TotalOdds) ?? -110;
  const homeML = toNum(line.HomeML);
  const awayML = toNum(line.AwayML);

  if (market === 'SPREAD') {
    if (spread === undefined) return { result: 'PUSH', payout: stake }; // no line? neutral
    const margin = homePts - awayPts; // home perspective
    // HOME takes spread; AWAY takes opposite
    const selSpread = selection === 'HOME' ? spread : -spread;
    const diff = margin - selSpread;

    if (diff > 0) return { result: 'WIN', payout: payoutTotal(stake, spreadOdds) };
    if (diff < 0) return { result: 'LOSS', payout: 0 };
    return { result: 'PUSH', payout: stake };
  }

  if (market === 'TOTAL') {
    if (total === undefined) return { result: 'PUSH', payout: stake };
    const pts = homePts + awayPts;
    if (selection === 'OVER') {
      if (pts > total) return { result: 'WIN', payout: payoutTotal(stake, totalOdds) };
      if (pts < total) return { result: 'LOSS', payout: 0 };
      return { result: 'PUSH', payout: stake };
    } else {
      if (pts < total) return { result: 'WIN', payout: payoutTotal(stake, totalOdds) };
      if (pts > total) return { result: 'LOSS', payout: 0 };
      return { result: 'PUSH', payout: stake };
    }
  }

  // ML
  if (selection === 'HOME') {
    if (homePts > awayPts) return { result: 'WIN', payout: payoutTotal(stake, homeML ?? -110) };
    if (homePts < awayPts) return { result: 'LOSS', payout: 0 };
    return { result: 'PUSH', payout: stake }; // tie
  } else {
    if (awayPts > homePts) return { result: 'WIN', payout: payoutTotal(stake, awayML ?? -110) };
    if (awayPts < homePts) return { result: 'LOSS', payout: 0 };
    return { result: 'PUSH', payout: stake }; // tie
  }
}

/** Update Google Sheet Wagers row that matches BetId (first match). */
async function writeWagerSettlementToSheet(betId: string, fields: Record<string, any>) {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const wagersSheet = await openSheetByTitle(sheetId, 'Wagers');
  const rows: any[] = await wagersSheet.getRows();
  const row = rows.find((r: any) => String(r.BetId ?? '') === betId);
  if (!row) return false;
  Object.entries(fields).forEach(([k, v]) => (row[k] = v));
  await row.save();
  return true;
}

/** Settle all pending wagers for a specific game, then credit wallets. */
export async function settleWagersForGame(gameId: number) {
  // Load the game
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.homePts == null || game.awayPts == null) return;

  // Read matching line row
  const line = await readLinesRow(
    Number(game.season ?? 0),
    Number(game.week ?? 0),
    game.homeTeam,
    game.awayTeam
  );
  if (!line) {
    console.warn(`[settle] Lines row not found for S${game.season} W${game.week} ${game.homeTeam} vs ${game.awayTeam}`);
    return;
  }

  // Get all pending wagers for this matchup from the Wagers sheet (by Season/Week/Teams)
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const wagersSheet = await openSheetByTitle(sheetId, 'Wagers');
  const rows: any[] = await wagersSheet.getRows();
  const candidates = rows.filter((r: any) =>
    String(r.Season ?? '') == String(game.season ?? '') &&
    String(r.Week ?? '') == String(game.week ?? '') &&
    String((r.HomeTeam ?? '')).trim() === game.homeTeam &&
    String((r.AwayTeam ?? '')).trim() === game.awayTeam &&
    String(r.Status ?? '').toUpperCase() !== 'SETTLED' &&
    String(r.Status ?? '').toUpperCase() !== 'VOID'
  );

  // Grade and aggregate wallet changes
  const creditsByCoach: Map<number, number> = new Map();

  for (const r of candidates) {
    const market = String(r.Market ?? '').toUpperCase() as 'SPREAD'|'TOTAL'|'ML';
    const selection = String(r.Selection ?? '').toUpperCase() as 'HOME'|'AWAY'|'OVER'|'UNDER';
    const stake = Number(r.Stake ?? 0);
    const coachId = Number(r.CoachId ?? 0);
    const betId = String(r.BetId ?? '');

    if (!stake || !coachId || !market || !selection) continue;

    const { result, payout } = gradeWager(
      market, selection,
      Number(game.homePts), Number(game.awayPts),
      line, stake
    );

    // Accrue wallet credit (only payout amount; stake already debited on placebet)
    if (payout > 0) {
      const add = payout; // includes stake for WIN / PUSH
      creditsByCoach.set(coachId, (creditsByCoach.get(coachId) ?? 0) + add);
    }

    // Update this row in the sheet
    r.Status = 'SETTLED';
    r.Result = result;
    r.Payout = Math.round(payout); // or keep decimals if you prefer
    await r.save();

    // Optionally: if you want to also keep a copy in DB, you can add a Wager model and persist here.
    // For now we treat the Sheet as source of truth for wager rows.
  }

  // Credit wallets in DB (bulk)
  for (const [coachId, amount] of creditsByCoach.entries()) {
    await prisma.wallet.upsert({
      where: { coachId },
      create: { coachId, balance: Math.round(amount) },
      update: { balance: { increment: Math.round(amount) } },
    });
  }
}
