// src/lib/googleAuth.ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { GoogleSpreadsheet } from 'google-spreadsheet';

function clean(s: string) {
  return s.trim().replace(/^["'`]|["'`]$/g, '');
}

function loadCreds(): { client_email: string; private_key: string } {
  const rawB64 =
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_PRIVATE_KEY_BASE64 ||
    process.env.GOOGLE_PRIVATE_KEY_B64 ||
    '';

  if (!rawB64.trim()) {
    // Fallback to plain env vars (PEM + email)
    const pem = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
    const email =
      process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
    const private_key = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
    if (!email || !private_key.startsWith('-----BEGIN ')) {
      throw new Error('No Google creds: set GOOGLE_CREDENTIALS_BASE64 or PEM + email envs.');
    }
    return { client_email: email, private_key };
  }

  const decoded = Buffer.from(clean(rawB64), 'base64').toString('utf8').trim();

  // Try JSON first (recommended path)
  try {
    const obj = JSON.parse(decoded);
    const client_email: string =
      String(obj.client_email || '').trim() ||
      String(process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    let private_key: string = String(obj.private_key || '').trim();
    if (private_key.includes('\\n')) private_key = private_key.replace(/\\n/g, '\n');
    if (!client_email || !private_key.startsWith('-----BEGIN ')) {
      throw new Error('Decoded JSON missing client_email/private_key');
    }
    return { client_email, private_key };
  } catch {
    // Not JSON – maybe it’s a PEM
    const client_email =
      process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
    const private_key = decoded.includes('\\n') ? decoded.replace(/\\n/g, '\n') : decoded;
    if (!client_email) throw new Error('PEM provided but GOOGLE_CLIENT_EMAIL is not set.');
    if (!private_key.startsWith('-----BEGIN ')) {
      throw new Error('Base64 creds did not decode to JSON or PEM. Recreate the env value.');
    }
    return { client_email, private_key };
  }
}
import { loadCreds } from '../lib/googleAuth'; // export it if needed
const test = loadCreds();
console.log('[Sheets] using:', test.client_email, 'key head:', test.private_key.slice(0, 30));
export async function openSheetByTitle(spreadsheetId: string, sheetTitle: string) {
  if (!spreadsheetId) throw new Error('Missing GOOGLE_SHEET_ID');
  const { client_email, private_key } = loadCreds();

  const doc = new GoogleSpreadsheet(spreadsheetId);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await doc.useServiceAccountAuth({ client_email, private_key });
  await doc.loadInfo();

  const sheet = (doc as any).sheetsByTitle?.[sheetTitle];
  if (!sheet) {
    const names = Object.values((doc as any).sheetsByTitle || {})
      .map((s: any) => s.title)
      .join(', ');
    throw new Error(`Tab "${sheetTitle}" not found. Available: ${names || '(none)'}`);
  }
  return sheet;
}
