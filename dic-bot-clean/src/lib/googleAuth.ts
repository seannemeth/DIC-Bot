// src/lib/googleAuth.ts
// google-spreadsheet v3 (no TS types)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { GoogleSpreadsheet } from 'google-spreadsheet';

/** Robustly load the service-account private key from env in multiple formats. */
export function loadGooglePrivateKey(): string {
  // Accept either env name to avoid typos
  const b64Raw =
    (process.env.GOOGLE_PRIVATE_KEY_BASE64 ||
      process.env.GOOGLE_PRIVATE_KEY_B64 ||
      '').trim();

  if (b64Raw) {
    // Strip accidental surrounding quotes/backticks
    const b64 = b64Raw.replace(/^["'`]|["'`]$/g, '');
    const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();

    // A) Already a proper PEM
    if (decoded.startsWith('-----BEGIN ')) return decoded;

    // B) Base64 was an entire JSON service-account file
    try {
      const obj = JSON.parse(decoded);
      const k = typeof obj?.private_key === 'string' ? obj.private_key.trim() : '';
      if (k) return k.includes('\\n') ? k.replace(/\\n/g, '\n') : k;
    } catch { /* not JSON */ }

    // C) Quoted PEM string
    const unq = decoded.replace(/^["'`]|["'`]$/g, '');
    if (unq.includes('BEGIN PRIVATE KEY')) {
      return unq.includes('\\n') ? unq.replace(/\\n/g, '\n') : unq;
    }
  }

  // Fallback: non-base64 env with \n escapes
  const raw = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

/** Open a Google Sheet tab by exact title and return the sheet instance. */
export async function openSheetByTitle(title: string) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;

  if (!sheetId || !clientEmail) {
    throw new Error(
      `Missing env: ${!sheetId ? 'GOOGLE_SHEET_ID ' : ''}${!clientEmail ? 'GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL' : ''}`.trim()
    );
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
