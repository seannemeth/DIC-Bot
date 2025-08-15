import { SlashCommandBuilder } from 'discord.js';
import { GoogleSpreadsheet } from 'google-spreadsheet';

export const data = new SlashCommandBuilder()
  .setName('lines')
  .setDescription('Reads the Lines sheet');

export async function execute(interaction) {
  try {
    // Decode the key from base64
    const privateKey = Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, 'base64').toString('utf8');

    // Create the document object
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

    // Authenticate with Google Sheets API
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
    });

    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['Lines']; // Make sure the sheet name matches exactly

    if (!sheet) {
      await interaction.reply({ content: '❌ Lines sheet not found!', flags: 64 });
      return;
    }

    const rows = await sheet.getRows();
    if (!rows.length) {
      await interaction.reply({ content: 'No data found in Lines sheet.', flags: 64 });
      return;
    }

    // Example: Just return first row, change this to what you need
    await interaction.reply(`First row: ${JSON.stringify(rows[0])}`);
  } catch (error) {
    console.error('❌ Error reading Lines sheet:', error);
    await interaction.reply({ content: `❌ Error: ${error.message}`, flags: 64 });
  }
}
