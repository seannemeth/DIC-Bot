// src/commands/lines.ts
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { GoogleSpreadsheet } from 'google-spreadsheet';

async function fetchLines(): Promise<string[]> {
  try {
    const sheetId = process.env.GOOGLE_SHEET_ID!;
    const doc = new GoogleSpreadsheet(sheetId);
    // Service account auth
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_CLIENT_EMAIL!,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    } as any);
    await doc.loadInfo();
    // Expect a tab named "Lines" with headers:
    // Season | Week | HomeTeam | AwayTeam | Spread | Total | HomeML | AwayML | Cutoff
    const sheet = doc.sheetsByTitle['Lines'];
    if (!sheet) return ['_No "Lines" sheet found_'];
    const rows = await sheet.getRows({ limit: 25 });
    if (!rows.length) return ['_No lines available_'];
    return rows.map((r: any, i: number) => {
      const wk = r.Week ?? '?';
      const h = r.HomeTeam ?? 'Home';
      const a = r.AwayTeam ?? 'Away';
      const spr = r.Spread ?? '-';
      const tot = r.Total ?? '-';
      const hml = r.HomeML ?? '-';
      const aml = r.AwayML ?? '-';
      return `**${i + 1}. Week ${wk}: ${h} vs ${a}**
Spread: ${spr} | Total: ${tot} | ML: ${hml} / ${aml}`;
    });
  } catch (e) {
    return ['_Error reading Lines sheet_'];
  }
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('lines')
    .setDescription('Show current betting lines (from Google Sheets)'),
  async execute(interaction: any) {
    await interaction.deferReply({ ephemeral: false });
    const lines = await fetchLines();
    const embed = new EmbedBuilder()
      .setTitle('📊 DIC Betting Lines')
      .setDescription(lines.join('\n\n'))
      .setColor(0x5865f2);
    await interaction.editReply({ embeds: [embed] });
  },
} as const;
