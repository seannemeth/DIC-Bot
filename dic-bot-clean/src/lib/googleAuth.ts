// src/lib/googleAuth.ts
// google-spreadsheet v3 lacks TS types; suppress where needed.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { GoogleSpreadsheet } from 'google-spreadsheet';

function stripQuotes(s: string) {
  return s.trim().replace(/^["'`]|["'`]$/g, '');
}

/** Load service account credentials from env, accepting multiple formats. */
export function loadCreds(): { client_email: string; private_key: string } {
  // Preferred: entire service-account JSON encoded as Base64 (one long line)
  const rawB64 =
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_PRIVATE_KEY_BASE64 ||
    process.env.GOOGLE_PRIVATE_KEY_B64 ||
    '';

  if (rawB64 && rawB64.trim().length > 0) {
    const decoded = Buffer.from(stripQuotes(rawB64), 'base64').toString('utf8').trim();

    // Try JSON file first (recommended)
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
      // Not JSON – treat decoded as PEM
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

  // Fallback: plain env vars with \n-escaped PEM
  const rawPem = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  const client_email =
    process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  if (rawPem && client_email) {
    const private_key = rawPem.includes('\\n') ? rawPem.replace(/\\n/g, '\n') : rawPem;
    if (!private_key.startsWith('-----BEGIN ')) {
      throw new Error('GOOGLE_PRIVATE_KEY is not a PEM');
    }
    return { client_email, private_key };
  }

  throw new Error(
    'No Google credentials found. Set GOOGLE_CREDENTIALS_BASE64 (preferred) or *_PRIVATE_KEY* + client email.'
  );
}

/** Open a Google Sheet tab by exact title and return the sheet instance. */
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
