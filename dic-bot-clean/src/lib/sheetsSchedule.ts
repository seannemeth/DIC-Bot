import { GoogleSpreadsheet } from 'google-spreadsheet';

function normalizeKey(k: string) {
  // supports raw PEM or \n-escaped env
  if (!k) return k;
  return k.includes('\\n') ? k.replace(/\\n/g, '\n') : k;
}

export async function readScheduleTab(tabName: string, explicitSheetId?: string) {
  const sheetId = explicitSheetId || process.env.SCHEDULE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('Missing GOOGLE_SHEET_ID or SCHEDULE_SHEET_ID');

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = normalizeKey(process.env.GOOGLE_PRIVATE_KEY || '');

  if (!clientEmail || !privateKey) throw new Error('Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY');

  const doc = new GoogleSpreadsheet(sheetId);
  // v3.3.0 style auth:
  // @ts-ignore legacy method exists on this version
  await doc.useServiceAccountAuth({ client_email: clientEmail, private_key: privateKey });
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[tabName];
  if (!sheet) throw new Error(`Tab not found: ${tabName}`);

  const rows = await sheet.getRows();
  // expect headers: home_team | away_team | home_discord_id | away_discord_id
  return rows.map((r: any) => ({
    home_team: String(r.home_team || '').trim(),
    away_team: String(r.away_team || '').trim(),
    home_discord_id: String(r.home_discord_id || '').trim(),
    away_discord_id: String(r.away_discord_id || '').trim(),
  }));
}
