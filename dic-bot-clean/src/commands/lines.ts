// src/commands/lines.ts
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
// google-spreadsheet v3 API
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { GoogleSpreadsheet } from 'google-spreadsheet';

function getServiceAccountKey(): string {
  const b64 = process.env.GOOGLE_PRIVATE_KEY_B64;
  if (b64 && b64.trim()) {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const k = process.env.GOOGLE_PRIVATE_KEY || '';
  return k.includes('\\n') ? k.replace(/\\n/g, '\n') : k;
}

async function getDoc() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = getServiceAccountKey();

  if (!sheetId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Google env vars. Need GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, and GOOGLE_PRIVATE_KEY_B64 (or GOOGLE_PRIVATE_KEY).'
    );
  }

  const doc = new GoogleSpreadsheet(sheetId);
  // v3 auth shape
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await doc.useServiceAccountAuth({ client_email: clientEmail, private_key: privateKey });
  await doc.loadInfo();
  return doc;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('lines')
    .setDescription('Show current betting lines (from Google Sheets)'),
  async execute(interaction: any) {
    await interaction.deferReply();
    try {
      const doc = await getDoc();
      const titles = Object.values(doc.sheetsByTitle).map((s: any) => s.title);
      const sheet = doc.sheetsByTitle['Lines'];
      if (!sheet) {
        const embed = new EmbedBuilder()
          .setTitle('Lines tab not found')
          .setDescription(`I couldn't find a tab named **Lines**.\n**Available tabs:**\n• ${titles.join('\n• ')}`)
          .setColor(0xffa500);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Expect headers: Season | Week | HomeTeam | AwayTeam | Spread | Total | HomeML | AwayML | Cutoff
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
      await interaction.editReply(`❌ Error reading Lines sheet: \`${e?.message || String(e)}\``);
    }
  },
} as const;
