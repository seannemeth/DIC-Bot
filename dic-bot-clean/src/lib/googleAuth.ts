import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export async function openSheetByTitle(spreadsheetId: string, sheetTitle: string) {
  // Decode base64 private key from env
  const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!privateKeyBase64) {
    throw new Error('GOOGLE_PRIVATE_KEY_BASE64 not set in environment variables.');
  }

  const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf-8');

  const client = new JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const doc = new GoogleSpreadsheet(spreadsheetId, client);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[sheetTitle];
  if (!sheet) {
    throw new Error(`Sheet "${sheetTitle}" not found`);
  }

  return sheet;
}
