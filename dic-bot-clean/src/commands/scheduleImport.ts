import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { getGoogleAuthClient } from '../lib/googleAuth';

const prisma = new PrismaClient();
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const TAB = process.env.SCHEDULE_TAB_NAME || 'Schedule';

export const command = {
  data: new SlashCommandBuilder()
    .setName('schedule_import')
    .setDescription('Import schedule from Google Sheet tab'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const auth = await getGoogleAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });

      const range = `${TAB}!A:D`;
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
      const rows = resp.data.values ?? [];

      const [header] = rows;
      const startIdx =
        header && (header[0] ?? '').toString().toLowerCase().includes('season') ? 1 : 0;
      const data = rows.slice(startIdx);

      let upserts = 0, skipped = 0;

      for (const r of data) {
        const [seasonRaw, weekRaw, home, away] =
          (r ?? []).map((col: unknown) => (col ?? '').toString().trim());
        if (!seasonRaw || !weekRaw || !home || !away) { skipped++; continue; }

        const season = parseInt(seasonRaw, 10);
        const week = parseInt(weekRaw, 10);
        if (Number.isNaN(season) || Number.isNaN(week)) { skipped++; continue; }

        await prisma.game.upsert({
          where: { season_week_homeTeam_awayTeam: { season, week, homeTeam: home, awayTeam: away } },
          create: { season, week, homeTeam: home, awayTeam: away, status: 'scheduled' },
          update: {}, // keep as scheduled if it already exists
        });
        upserts++;
      }

      await interaction.editReply(`✅ Imported schedule: ${upserts} upserts (skipped ${skipped}/${data.length}).`);
    } catch (e: any) {
      console.error(e);
      await interaction.editReply(`❌ Import failed: ${e.message ?? e}`);
    }
  },
} as const;
