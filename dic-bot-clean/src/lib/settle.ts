// src/lib/settle.ts
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

/** Lightweight mapper: rows[][] -> [{...}, ...] using headers; also includes __rowNumber */
function mapSheetRowsToObjects(allRows: string[][], title: string): Array<Record<string, any> & { __rowNumber: number }> {
  if (!allRows.length) return [];
  const header = (allRows[0] ?? []).map(h => (h ?? '').toString().trim());
  const out: Array<Record<string, any> & { __rowNumber: number }> = [];
  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i] ?? [];
    const obj: Record<string, any> & { __rowNumber: number } = { __rowNumber: i + 1 }; // 1-indexed in Sheets
    for (let j = 0; j < header.length; j++) {
      const key = header[j] || `Col${j + 1}`;
      obj[key] = row[j] ?? '';
    }
    out.push(obj);
  }
  return out;
}

/** Update a single row (by absolute row number) with the given fields, using the header order. */
async function updateRowByNumber(
  sheetCtx: { sheets: any; spreadsheetId: string; title: string },
  rowNumber: number,
  fields: Record<string, any>
) {
  const { sheets, spreadsheetId, title } = sheetCtx;

  // Fetch header to preserve column order
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!1:1`,
  });
  const header: string[] = (headerResp.data.values?.[0] ?? []).map((h: any) => (h ?? '').toString().trim());

  // Fetch the existing row to merge (optional — if you want to keep untouched columns)
  const rowResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A${rowNumber}:Z${rowNumber}`,
  });
  const existing: string[] = rowResp.data.values?.[0] ?? [];

  // Build updated row aligned to header
  const nextRow = header.map((h, idx) => {
    const v = fields.hasOwnProperty(h) ? fields[h] : existing[idx] ?? '';
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return v;
    return String(v);
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [nextRow] },
  });
}

async function readLinesRow(season: number, week: number, homeTeam: string, awayTeam: string) {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const linesSheet = await openSheetByTitle(sheetId, 'Lines');
  const allRows: string[][] = await linesSheet.getRows();
  const rows = mapSheetRowsToObjects(allRows, linesSheet.title);

  const match = rows.find(r =>
    String(r.Season ?? '') === String(season) &&
    String(r.Week ?? '') === String(week) &&
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
  const allRows: string[][] = await wagersSheet.getRows();
  const rows = mapSheetRowsToObjects(allRows, wagersSheet.title);
  const row = rows.find(r => String(r.BetId ?? '') === betId);
  if (!row) return false;

  await updateRowByNumber(
    { sheets: wagersSheet.sheets, spreadsheetId: wagersSheet.spreadsheetId, title: wagersSheet.title },
    row.__rowNumber,
    fields
  );
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
  const allRows: string[][] = await wagersSheet.getRows();
  const rows = mapSheetRowsToObjects(allRows, wagersSheet.title);

  // Header-aware filter (Status not SETTLED/VOID)
  const candidates = rows.filter(r =>
    String(r.Season ?? '') === String(game.season ?? '') &&
    String(r.Week ?? '') === String(game.week ?? '') &&
    String((r.HomeTeam ?? '')).trim() === game.homeTeam &&
    String((r.AwayTeam ?? '')).trim() === game.awayTeam &&
    String(r.Status ?? '').toUpperCase() !== 'SETTLED' &&
    String(r.Status ?? '').toUpperCase() !== 'VOID'
  );

  // Grade and aggregate wallet changes
  const creditsByCoach: Map<string, number> = new Map(); // coachId is STRING now

  for (const r of candidates) {
    const market = String(r.Market ?? '').toUpperCase() as 'SPREAD'|'TOTAL'|'ML';
    const selection = String(r.Selection ?? '').toUpperCase() as 'HOME'|'AWAY'|'OVER'|'UNDER';
    const stake = Number(r.Stake ?? 0);
    const coachId = String(r.CoachId ?? '').trim(); // string to match Wallet.coachId
    const betId = String(r.BetId ?? '');

    if (!stake || !coachId || !market || !selection) continue;

    const { result, payout } = gradeWager(
      market, selection,
      Number(game.homePts), Number(game.awayPts),
      line, stake
    );

    // Accrue wallet credit (includes stake for WIN / PUSH)
    if (payout > 0) {
      const add = payout;
      creditsByCoach.set(coachId, (creditsByCoach.get(coachId) ?? 0) + add);
    }

    // Update this row in the sheet
    await updateRowByNumber(
      { sheets: wagersSheet.sheets, spreadsheetId: wagersSheet.spreadsheetId, title: wagersSheet.title },
      r.__rowNumber,
      {
        Status: 'SETTLED',
        Result: result,
        Payout: Math.round(payout),
      }
    );

    // If you also want to write a settlement timestamp:
    // await updateRowByNumber(..., r.__rowNumber, { SettledAt: new Date().toISOString() });
  }

  // Credit wallets in DB (bulk)
  for (const [coachId, amount] of creditsByCoach.entries()) {
    const credit = Math.round(amount);
    await prisma.wallet.upsert({
      where: { coachId },
      create: { coachId, balance: credit },
      update: { balance: { increment: credit } },
    });
  }
}
