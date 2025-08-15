// src/lib/linesWriteback.ts
import { openSheetByTitle } from './googleAuth';

export async function upsertLinesScore(opts: {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homePts: number;
  awayPts: number;
}) {
  const { season, week, homeTeam, awayTeam, homePts, awayPts } = opts;

  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const sheet = await openSheetByTitle(sheetId, 'Lines');
  const rows: any[] = await sheet.getRows();

  // exact, trimmed match on season/week/teams
  const row = rows.find((r: any) =>
    String(r.Season ?? '').trim() === String(season) &&
    String(r.Week ?? '').trim() === String(week) &&
    String(r.HomeTeam ?? '').trim() === homeTeam &&
    String(r.AwayTeam ?? '').trim() === awayTeam
  );

  const status = 'Final';
  const result =
    homePts > awayPts ? 'HOME' :
    homePts < awayPts ? 'AWAY' : 'TIE';

  if (row) {
    row.HomeScore = homePts;
    row.AwayScore = awayPts;
    row.Status = status;
    row.Result = result;
    await row.save();
    return { action: 'updated' as const };
  } else {
    // If no row exists, append a minimal one so sheet is complete.
    await sheet.addRow({
      Season: season,
      Week: week,
      HomeTeam: homeTeam,
      AwayTeam: awayTeam,
      HomeScore: homePts,
      AwayScore: awayPts,
      Status: status,
      Result: result,
    });
    return { action: 'inserted' as const };
  }
}
