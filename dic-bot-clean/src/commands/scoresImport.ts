// src/commands/scoresImport.ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { getGoogleAuthClient } from '../lib/googleAuth';
import { settleWagersForGame } from '../lib/settle';
import { upsertLinesScore } from '../lib/linesWriteback';

const prisma = new PrismaClient();

// Accept multiple env names; first non-empty wins
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
  process.env.GOOGLE_SHEET_ID?.trim() ||
  process.env.SHEET_ID?.trim() ||
  '';

const TAB = (process.env.SCORES_TAB_NAME || 'Scores').trim();

function norm(s: unknown) {
  return String(s ?? '').trim();
}
function keyify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ''); // "Home Score" -> "homescore"
}

// Accept common header variants → canonical keys
const headerAliases: Record<string, 'season'|'week'|'hometeam'|'awayteam'|'homepts'|'awaypts'> = {
  season: 'season',
  yr: 'season',
  week: 'week',
  wk: 'week',
  hometeam: 'hometeam',
  home: 'hometeam',
  hom: 'hometeam',
  awayteam: 'awayteam',
  away: 'awayteam',
  awy: 'awayteam',
  homepts: 'homepts',
  homepoints: 'homepts',
  home_score: 'homepts',
  homescore: 'homepts',
  h: 'homepts',
  awaypts: 'awaypts',
  awaypoints: 'awaypts',
  awayscore: 'awaypts',
  away_score: 'awaypts',
  a: 'awaypts',
};

function mapHeader(headerRow: string[]) {
  const map: Record<'season'|'week'|'hometeam'|'awayteam'|'homepts'|'awaypts', number | undefined> = {
    season: undefined, week: undefined, hometeam: undefined, awayteam: undefined, homepts: undefined, awaypts: undefined
  };
  headerRow.forEach((h, idx) => {
    const k = keyify(h);
    const aliased = headerAliases[k as keyof typeof headerAliases];
    if (aliased && map[aliased] === undefined) map[aliased] = idx;
  });
  const hasAll = Object.values(map).every(v => typeof v === 'number');
  return { map, hasAll };
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('scores_import')
    .setDescription('Import final scores from Google Sheets tab (auto-confirms + settles)'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    if (!SPREADSHEET_ID) {
      await interaction.editReply(
        '❌ Missing spreadsheet id. Set `GOOGLE_SHEETS_SPREADSHEET_ID` (or `GOOGLE_SHEET_ID`) in Railway.'
      );
      return;
    }

    try {
      const auth = await getGoogleAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });

      // Verify tab exists and list alternatives if not
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const tabs = (meta.data.sheets ?? []).map(s => s.properties?.title).filter(Boolean) as string[];
      const foundTab = tabs.find(t => t?.toLowerCase().trim() === TAB.toLowerCase());
      if (!foundTab) {
        await interaction.editReply(`❌ Tab **${TAB}** not found. Available tabs:\n• ${tabs.join('\n• ')}`);
        return;
      }

      const idPrint = SPREADSHEET_ID.length > 8
        ? `${SPREADSHEET_ID.slice(0, 4)}…${SPREADSHEET_ID.slice(-4)}`
        : SPREADSHEET_ID;

      // Read a wide range and normalize
      const range = `${foundTab}!A:Z`;
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
      const all = (resp.data.values ?? []).map(row => row.map(norm));

      // Skip leading empty rows
      let firstDataIdx = 0;
      while (firstDataIdx < all.length && all[firstDataIdx].every(c => !c)) firstDataIdx++;
      if (firstDataIdx >= all.length) {
        await interaction.editReply(`No rows found in **${foundTab}** @ **${idPrint}** (A:Z all empty).`);
        return;
      }

      // Detect header + map positions
      const headerRow = all[firstDataIdx] as string[];
      const { map, hasAll } = mapHeader(headerRow);

      let dataRows: string[][];
      let usedHeader = false;
      if (hasAll) {
        dataRows = all.slice(firstDataIdx + 1);
        usedHeader = true;
      } else {
        // fallback positional: A..F = Season,Week,HomeTeam,AwayTeam,HomePts,AwayPts
        dataRows = all.slice(firstDataIdx);
      }

      // Consider row "data" if any of the mapped (or positional) fields has a value
      const rows = dataRows.filter((r) => {
        if (usedHeader) {
          const fields = [
            r[map.season!], r[map.week!],
            r[map.hometeam!], r[map.awayteam!],
            r[map.homepts!], r[map.awaypts!],
          ].map(norm);
          return fields.some(Boolean);
        } else {
          const fields = [r[0], r[1], r[2], r[3], r[4], r[5]].map(norm);
          return fields.some(Boolean);
        }
      });

      // Diagnostics
      const headerMapInfo = usedHeader
        ? `header map idx: season=${map.season}, week=${map.week}, home=${map.hometeam}, away=${map.awayteam}, homePts=${map.homepts}, awayPts=${map.awaypts}`
        : 'no header detected (positional A..F)';
      const peek = dataRows.slice(0, 5).map((r, i) => `r${i+1}: ${JSON.stringify(r.slice(0, 10))}`).join('\n');

      if (rows.length === 0) {
        await interaction.editReply(
          `Found header but 0 usable data rows in **${foundTab}** @ **${idPrint}**.\n` +
          `${headerMapInfo}\n` +
          `Peek:\n${peek || '(empty)'}`
        );
        return;
      }

      // Parse and import
      let upserts = 0, skipped = 0, settled = 0, wroteLines = 0;
      const sampleParsed: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        const seasonRaw   = usedHeader && map.season   !== undefined ? r[map.season]   : r[0];
        const weekRaw     = usedHeader && map.week     !== undefined ? r[map.week]     : r[1];
        const homeRaw     = usedHeader && map.hometeam !== undefined ? r[map.hometeam] : r[2];
        const awayRaw     = usedHeader && map.awayteam !== undefined ? r[map.awayteam] : r[3];
        const homePtsRaw  = usedHeader && map.homepts  !== undefined ? r[map.homepts]  : r[4];
        const awayPtsRaw  = usedHeader && map.awaypts  !== undefined ? r[map.awaypts]  : r[5];

        const season = parseInt(seasonRaw ?? '', 10);
        const week   = parseInt(weekRaw ?? '', 10);
        const homeTeam = norm(homeRaw);
        const awayTeam = norm(awayRaw);
        const homePts  = Number(homePtsRaw);
        const awayPts  = Number(awayPtsRaw);

        if (
          !seasonRaw || !weekRaw || !homeTeam || !awayTeam ||
          Number.isNaN(season) || Number.isNaN(week) ||
          !Number.isFinite(homePts) || !Number.isFinite(awayPts)
        ) {
          skipped++; continue;
        }

        if (sampleParsed.length < 5) {
          sampleParsed.push(`S${season} W${week} ${homeTeam} ${homePts}-${awayPts} ${awayTeam}`);
        }

        const [homeCoach, awayCoach] = await Promise.all([
          prisma.coach.findFirst({ where: { team: { equals: homeTeam, mode: 'insensitive' } } }),
          prisma.coach.findFirst({ where: { team: { equals: awayTeam, mode: 'insensitive' } } }),
        ]);

        // Upsert game + auto-confirm
        const game = await prisma.game.upsert({
          where: { season_week_homeTeam_awayTeam: { season, week, homeTeam, awayTeam } },
          create: {
            season, week, homeTeam, awayTeam,
            homePts, awayPts,
            status: 'confirmed' as any,
            homeCoachId: homeCoach?.id,
            awayCoachId: awayCoach?.id,
          },
          update: {
            homePts, awayPts,
            status: 'confirmed' as any,
            homeCoachId: homeCoach?.id ?? undefined,
            awayCoachId: awayCoach?.id ?? undefined,
          },
        });
        upserts++;

        // Write back to Lines
        try {
          await upsertLinesScore({ season, week, homeTeam, awayTeam, homePts, awayPts });
          wroteLines++;
        } catch (e) {
          console.error('[Lines writeback] failed:', e);
        }

        // Settle
        try {
          await settleWagersForGame(game.id);
          settled++;
        } catch (e) {
          console.error('[settle] failed:', e);
        }
      }

      const diag = [
        `Tab: **${foundTab}** @ **${idPrint}**`,
        `Detected header: ${usedHeader ? 'yes' : 'no (positional A..F)'}`,
        headerMapInfo,
        sampleParsed.length ? `Sample: ${sampleParsed.join(' • ')}` : 'Sample: (none)',
      ].join('\n');

      await interaction.editReply(
        `✅ Scores import: ${upserts} upserts, ${settled} settled, ${wroteLines} lines-updated (skipped ${skipped}/${rows.length}).\n${diag}`
      );
    } catch (e: any) {
      console.error('[scores_import] failed:', e);
      await interaction.editReply(`❌ Import failed: ${e?.message || e}`);
    }
  },
} as const;
