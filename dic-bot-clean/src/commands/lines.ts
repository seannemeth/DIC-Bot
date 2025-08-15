// src/commands/lines.ts
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { GoogleSpreadsheet } from 'google-spreadsheet';

function fixKey(k?: string) {
  if (!k) return '';
  // If already multiline, return as-is; if escaped, unescape
  return k.includes('\\n') ? k.replace(/\\n/g, '\n') : k;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('lines')
    .setDescription('Show current betting lines from Google Sheets'),
  async execute(interaction: any) {
    await interaction.deferReply();

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = fixKey(process.env.GOOGLE_PRIVATE_KEY);

    if (!sheetId || !clientEmail || !privateKey) {
      await interaction.editReply(
        '❌ Missing Google env vars. Need GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY.'
      );
      return;
    }

    try {
      const doc = new GoogleSpreadsheet(sheetId);
      // @ts-ignore – v3 auth shape
      await doc.useServiceAccountAuth({ client_email: clientEmail, private_key: privateKey });
      await doc.loadInfo();

      // Debug: show available tab names so you can match exactly
      const titles = Object.values(doc.sheetsByTitle).map((s: any) => s.title);
      const sheet = doc.sheetsByTitle['Lines'];
      if (!sheet) {
        const embed = new EmbedBuilder()
          .setTitle('Lines tab not found')
          .setDescription(
            `I couldn't find a tab named **Lines**.\n\n**Available tabs:**\n• ${titles.join('\n• ')}`
          )
          .setColor(0xffa500);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Read first 25 rows
      const rows = await sheet.getRows({ limit: 25 });
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
    } catch (e: any) {
      const msg = e?.message || String(e);
      await interaction.editReply(`❌ Error reading Lines sheet: \`${msg}\``);
    }
  },
} as const;
