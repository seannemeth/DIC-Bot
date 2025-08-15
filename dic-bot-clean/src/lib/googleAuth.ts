// src/lib/googleAuth.ts
// google-spreadsheet v3
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { GoogleSpreadsheet } from 'google-spreadsheet';

/** Robustly load the service-account private key from env in multiple formats. */
export function loadGooglePrivateKey(): string {
  const b64 = process.env.GOOGLE_PRIVATE_KEY_BASE64?.trim();
  if (b64) {
    const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();

    // Case 1: proper PEM already
    if (decoded.startsWith('-----BEGIN ')) return decoded;

    // Case 2: base64 was the whole JSON file
    try {
      const obj = JSON.parse(decoded);
      if (typeof obj?.private_key === 'string') {
        return obj.private_key.includes('\\n') ? obj.private_key.replace(/\\n/g, '\n') : obj.private_key;
      }
    } catch {/* not JSON */}

    // Case 3: quoted JSON string of the key value
    const unquoted = decoded.replace(/^["']|["']$/g, '');
    if (unquoted.includes('BEGIN PRIVATE KEY')) {
      return unquoted.includes('\\n') ? unquoted.replace(/\\n/g, '\n') : unquoted;
    }
  }

  // Fallback: non-base64 env with \n escapes
  const raw = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export async function openSheetByTitle(title: string) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;

  if (!sheetId || !clientEmail) {
    throw new Error(`Missing env: ${!sheetId ? 'GOOGLE_SHEET_ID ' : ''}${!clientEmail ? 'GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL' : ''}`.trim());
  }

  const private_key = loadGooglePrivateKey();
  if (!private_key.startsWith('-----BEGIN ')) {
    throw new Error('Private key did not decode to a PEM. Check GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_PRIVATE_KEY.');
  }

  const doc = new GoogleSpreadsheet(sheetId);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await doc.useServiceAccountAuth({ client_email: clientEmail, private_key });
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    const names = Object.values(doc.sheetsByTitle).map((s: any) => s.title).join(', ');
    throw new Error(`Tab "${title}" not found. Available: ${names || '(none)'}`);
  }
  return sheet;
}
