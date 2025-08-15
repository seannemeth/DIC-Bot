import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { getGoogleAuthClient } from '../lib/googleAuth';

const prisma = new PrismaClient();

// Accept multiple env var names; first non-empty wins
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
  process.env.GOOGLE_SHEET_ID?.trim() ||
  process.env.SHEET_ID?.trim() ||
  '';

const TAB = (process.env.SCHEDULE_TAB_NAME || 'Schedule').trim();

export const command = {
  data: new SlashCommandBuilder()
    .setName('schedule_import')
    .setDescription('Import schedule from Google Sheet tab'),
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

      // quick ping so we know what the bot sees
      const idPrint = SPREADSHEET_ID.length > 8
        ? `${SPREADSHEET_ID.slice(0, 4)}…${SPREADSHEET_ID.slice(-4)}`
        : SPREADSHEET_ID;

      // fetch A:D: Season, Week, Home, Away
      const range = `${TAB}!A:D`;
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range,
      });

      const rows = resp.data.values ?? [];
      const [header] = rows;
      const looksLikeHeader =
        Array.isArray(header) &&
        header.some((cell) => String(cell ?? '').toLowerCase().includes('season'));
      const data = rows.slice(looksLikeHeader ? 1 : 0);

      let upserts = 0,
        skipped = 0;

      for (const r of data) {
        const [seasonRaw, weekRaw, homeRaw, awayRaw] = (r ?? []).map((c: unknown) =>
          (c ?? '').toString()
        );
        const home = homeRaw.trim();
        const away = awayRaw.trim();

        if (!seasonRaw || !weekRaw || !home || !away) {
          skipped++;
          continue;
        }

        const season = parseInt(seasonRaw, 10);
        const week = parseInt(weekRaw, 10);
        if (Number.isNaN(season) || Number.isNaN(week)) {
          skipped++;
          continue;
        }

        await prisma.game.upsert({
          where: {
            season_week_homeTeam_awayTeam: { season, week, homeTeam: home, awayTeam: away },
          },
          create: { season, week, homeTeam: home, awayTeam: away, status: 'scheduled' },
          update: {}, // leave existing records as-is
        });
        upserts++;
      }

      await interaction.editReply(
        `✅ Imported schedule from **${TAB}** @ **${idPrint}**: ${upserts} upserts (skipped ${skipped}/${data.length}).`
      );
    } catch (e: any) {
      // common gotchas: sheet not shared with service account; wrong tab name; wrong ID
      const msg = e?.message || String(e);
      await interaction.editReply(`❌ Import failed: ${msg}`);
      console.error('[schedule_import] failed:', e);
    }
  },
} as const;
