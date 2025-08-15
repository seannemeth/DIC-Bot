// src/lib/scheduleImport.ts
import { google } from 'googleapis';
import { getGoogleAuthClient } from '../lib/googleAuth';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!; // reuse what /lines uses if you already have it
const TAB = process.env.SCHEDULE_TAB_NAME || 'Schedule';

export async function importScheduleFromSheet() {
  const auth = await getGoogleAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const range = `${TAB}!A:D`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = resp.data.values ?? [];

  // optional: skip header
  const [header, ...data] = rows;
  const startIdx = header && header[0]?.toLowerCase().includes('season') ? 1 : 0;
  const body = rows.slice(startIdx);

  let created = 0, skipped = 0;
  for (const r of body) {
    const [seasonRaw, weekRaw, home, away] = r.map(col => (col ?? '').toString().trim());
    if (!seasonRaw || !weekRaw || !home || !away) { skipped++; continue; }

    const season = parseInt(seasonRaw, 10);
    const week = parseInt(weekRaw, 10);
    if (Number.isNaN(season) || Number.isNaN(week)) { skipped++; continue; }

    await prisma.game.upsert({
      where: { game_unique: { season, week, homeTeam: home, awayTeam: away } },
      create: { season, week, homeTeam: home, awayTeam: away, status: 'scheduled' },
      update: {}, // don't overwrite if already exists
    });
    created++;
  }

  return { created, skipped, total: body.length };
}
