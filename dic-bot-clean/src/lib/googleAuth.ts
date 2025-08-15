import { google, sheets_v4 } from 'googleapis';

function decodeBase64Json(b64: string) {
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function getGoogleAuthClient() {
  const b64 = process.env.GOOGLE_CREDENTIALS_BASE64?.trim();
  const email = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  let key = process.env.GOOGLE_PRIVATE_KEY?.trim();

  // Try full JSON (base64) first
  if (b64) {
    const parsed = decodeBase64Json(b64);
    if (parsed?.client_email && parsed?.private_key) {
      return new google.auth.JWT({
        email: parsed.client_email,
        key: parsed.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    console.error('⚠️ GOOGLE_CREDENTIALS_BASE64 exists but is not valid JSON with client_email/private_key.');
  }

  // Fallback: email + key
  if (email && key) {
    if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
    return new google.auth.JWT({
      email,
      key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  throw new Error('Missing Google credentials. Provide GOOGLE_CREDENTIALS_BASE64 or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.');
}

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = await getGoogleAuthClient();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Legacy helper used across your codebase.
 * Returns: { sheets, spreadsheetId, sheetId, title }
 */
export async function openSheetByTitle(spreadsheetId: string, title: string) {
  const sheets = await getSheetsClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === title);

  if (!sheet?.properties?.sheetId) {
    const titles = (meta.data.sheets ?? []).map(s => s.properties?.title).filter(Boolean);
    throw new Error(`Sheet "${title}" not found. Available tabs: ${titles.join(', ')}`);
  }

  return {
    sheets,
    spreadsheetId,
    sheetId: sheet.properties.sheetId,
    title,
  };
}
