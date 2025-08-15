import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { google } from 'googleapis';
import { PrismaClient, GameStatus } from '@prisma/client';
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

/**
 * Expected columns (header row optional; importer will detect/skip it):
 * A: Season
 * B: Week
 * C: HomeTeam
 * D: AwayTeam
 * E: HomePts
 * F: AwayPts
 * (Optional) G: Status   // ignored; we auto-confirm on import
 */
export const command = {
  data: new SlashCommandBuilder()
    .setName('scores_import')
    .setDescription('Import final scores from Google Sheets tab (auto-confirms + settles)'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      if (!SPREADSHEET_ID) {
        await interaction.editReply(
          '❌ Missing spreadsheet id. Set `GOOGLE_SHEETS_SPREADSHEET_ID` (or `GOOGLE_SHEET_ID`) in Railway.'
        );
        return;
      }

      const auth = await getGoogleAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });

      const range = `${TAB}!A:G`;
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range,
      });

      const rows = resp.data.values ?? [];
      if (!rows.length) {
        await interaction.editReply(`No rows found in **${TAB}**.`);
        return;
      }

      const [header] = rows;
      const looksLikeHeader =
        Array.isArray(header) &&
        header.some((cell) => String(cell ?? '').toLowerCase().includes('season'));
      const data = rows.slice(looksLikeHeader ? 1 : 0);

      let upserts = 0, skipped = 0, settled = 0, wroteLines = 0;

      for (const r of data) {
        const [
          seasonRaw, weekRaw,
          homeRaw, awayRaw,
          homePtsRaw, awayPtsRaw,
        ] = (r ?? []).map((c: unknown) => (c ?? '').toString().trim());

        if (!seasonRaw || !weekRaw || !homeRaw || !awayRaw || !homePtsRaw || !awayPtsRaw) {
          skipped++; continue;
        }

        const season = parseInt(seasonRaw, 10);
        const week = parseInt(weekRaw, 10);
        const homeTeam = homeRaw;
        const awayTeam = awayRaw;
        const homePts = Number(homePtsRaw);
        const awayPts = Number(awayPtsRaw);

        if (
          Number.isNaN(season) || Number.isNaN(week) ||
          !Number.isFinite(homePts) || !Number.isFinite(awayPts)
        ) { skipped++; continue; }

        // Optional: link coaches if present
        const [homeCoach, awayCoach] = await Promise.all([
          prisma.coach.findFirst({ where: { team: { equals: homeTeam, mode: 'insensitive' } } }),
          prisma.coach.findFirst({ where: { team: { equals: awayTeam, mode: 'insensitive' } } }),
        ]);

        // Upsert Game and AUTO-CONFIRM
        const game = await prisma.game.upsert({
          where: {
            season_week_homeTeam_awayTeam: { season, week, homeTeam, awayTeam },
          },
          create: {
            season, week, homeTeam, awayTeam,
            homePts, awayPts,
            status: GameStatus.confirmed,
            homeCoachId: homeCoach?.id,
            awayCoachId: awayCoach?.id,
          },
          update: {
            homePts, awayPts,
            status: GameStatus.confirmed,
            homeCoachId: homeCoach?.id ?? undefined,
            awayCoachId: awayCoach?.id ?? undefined,
          },
        });
        upserts++;

        // Write back to Lines sheet
        try {
          await upsertLinesScore({ season, week, homeTeam, awayTeam, homePts, awayPts });
          wroteLines++;
        } catch (e) {
          console.error('[Lines writeback] failed:', e);
        }

        // Settle wagers for this game
        try {
          await settleWagersForGame(game.id);
          settled++;
        } catch (e) {
          console.error('[settle] failed:', e);
        }
      }

      await interaction.editReply(
        `✅ Scores import from **${TAB}**: ${upserts} upserts, ${settled} settled, ${wroteLines} lines-updated (skipped ${skipped}/${data.length}).`
      );
    } catch (e: any) {
      console.error('[scores_import] failed:', e);
      await interaction.editReply(`❌ Import failed: ${e?.message || e}`);
    }
  },
} as const;
