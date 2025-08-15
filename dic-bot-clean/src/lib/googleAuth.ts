// google-spreadsheet v3 (no TS types)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { GoogleSpreadsheet } from 'google-spreadsheet';

function readCreds() {
  // Prefer entire JSON file in base64 (recommended)
  const credB64 = (process.env.GOOGLE_CREDENTIALS_BASE64 || process.env.GOOGLE_PRIVATE_KEY_BASE64 || '').trim();
  if (!credB64) throw new Error('Missing GOOGLE_CREDENTIALS_BASE64 (or GOOGLE_PRIVATE_KEY_BASE64)');

  const json = Buffer.from(credB64.replace(/^["'`]|["'`]$/g, ''), 'base64').toString('utf8').trim();
  let obj: any;
  try { obj = JSON.parse(json); } catch { throw new Error('Base64 creds do not decode to JSON'); }

  const client_email = String(obj.client_email || process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  let private_key = String(obj.private_key || '').trim();
  if (private_key.includes('\\n')) private_key = private_key.replace(/\\n/g, '\n');

  if (!client_email || !private_key.startsWith('-----BEGIN ')) {
    throw new Error('Decoded JSON missing valid client_email/private_key');
  }
  return { client_email, private_key };
}

/** Open a Google Sheet tab by exact title and return the sheet instance. */
export async function openSheetByTitle(spreadsheetId: string, sheetTitle: string) {
  if (!spreadsheetId) throw new Error('Missing env: GOOGLE_SHEET_ID');

  const { client_email, private_key } = readCreds();

  const doc = new GoogleSpreadsheet(spreadsheetId);
  // Explicit v3 auth path (works reliably)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await doc.useServiceAccountAuth({ client_email, private_key });
  await doc.loadInfo();

  const sheet = (doc as any).sheetsByTitle?.[sheetTitle];
  if (!sheet) {
    const names = Object.values((doc as any).sheetsByTitle || {}).map((s: any) => s.title).join(', ');
    throw new Error(`Tab "${sheetTitle}" not found. Available: ${names || '(none)'}`);
  }
  return sheet;
}
