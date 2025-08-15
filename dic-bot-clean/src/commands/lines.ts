// src/commands/lines.ts
import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { openSheetByTitle } from '../lib/googleAuth';

export const command = {
  data: new SlashCommandBuilder()
    .setName('lines')
    .setDescription('Show current betting lines (from Google Sheets)'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const sheetId = process.env.GOOGLE_SHEET_ID || '';
    try {
      const sheet = await openSheetByTitle(sheetId, 'Lines');
      const rows: any[] = await sheet.getRows({ limit: 25 });
      if (!rows.length) {
        await interaction.editReply('No lines available yet on the **Lines** tab.');
        return;
      }
      const lines = rows.map((r: any, i: number) => {
        const wk = r.Week ?? '?';
        const h = r.HomeTeam ?? 'Home';
        const a = r.AwayTeam ?? 'Away';
        const spr = r.Spread ?? '-';
        const tot = r.Total ?? '-';
        const hml = r.HomeML ?? '-';
        const aml = r.AwayML ?? '-';
        return `**${i + 1}. Week ${wk}: ${h} vs ${a}**\nSpread: ${spr} | Total: ${tot} | ML: ${hml} / ${aml}`;
      });
      const embed = new EmbedBuilder()
        .setTitle('📊 DIC Betting Lines')
        .setDescription(lines.join('\n\n'))
        .setColor(0x5865f2);
      await interaction.editReply({ embeds: [embed] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await interaction.editReply(`❌ Error reading Lines sheet: \`${msg}\``);
    }
  },
} as const;
