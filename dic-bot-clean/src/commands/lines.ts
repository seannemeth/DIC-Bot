// src/commands/lines.ts
import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';

// google-spreadsheet v3 has no TS types; suppress to keep build clean
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { GoogleSpreadsheet } from 'google-spreadsheet';

/** Load the service-account private key from env (Base64 preferred, fallback to \n-escaped). */
function getServiceAccountKey(): string {
  const b64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (b64 && b64.trim().length > 0) {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('lines')
    .setDescription('Show current betting lines (from Google Sheets)'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const clientEmail =
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || '';
    const privateKey = getServiceAccountKey();

    // Guard against undefined envs (fixes Buffer.from error and improves DX)
    if (!sheetId || !clientEmail || !privateKey) {
      const missing = [
        !sheetId ? 'GOOGLE_SHEET_ID' : null,
        !clientEmail ? 'GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL' : null,
        !privateKey ? 'GOOGLE_PRIVATE_KEY_BASE64/GOOGLE_PRIVATE_KEY' : null,
      ]
        .filter(Boolean)
        .join(', ');
      await interaction.editReply(
        `❌ Missing required env var(s): **${missing}**.`
      );
      return;
    }

    try {
      const doc = new GoogleSpreadsheet(sheetId);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore – v3 auth shape
      await doc.useServiceAccountAuth({
        client_email: clientEmail,
        private_key: privateKey,
      });
      await doc.loadInfo();

      // Help diagnose wrong tab names
      const titles = Object.values(doc.sheetsByTitle).map((s: any) => s.title);
      const sheet = doc.sheetsByTitle['Lines'];
      if (!sheet) {
        const embed = new EmbedBuilder()
          .setTitle('Lines tab not found')
          .setDescription(
            `I couldn't find a tab named **Lines**.\n**Available tabs:**\n• ${titles.join(
              '\n• '
            )}`
          )
          .setColor(0xffa500);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Expected headers: Season | Week | HomeTeam | AwayTeam | Spread | Total | HomeML | AwayML | Cutoff
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
