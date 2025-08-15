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
 * Open a tab by title and expose convenience methods compatible with older code:
 * - getRows(rangeA1?: string)
 * - getRows({ range?: string, limit?: number })
 * - addRow(values: (string|number|null)[])
 * - addRow(record: Record<string, any>)  // maps object to columns via header row
 */
export async function openSheetByTitle(spreadsheetId: string, title: string) {
  const sheets = await getSheetsClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === title);

  if (!sheet?.properties?.sheetId) {
    const titles = (meta.data.sheets ?? []).map(s => s.properties?.title).filter(Boolean);
    throw new Error(`Sheet "${title}" not found. Available tabs: ${titles.join(', ')}`);
  }

  const sheetId = sheet.properties.sheetId;

  async function fetchHeader(): Promise<string[]> {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${title}!1:1`,
    });
    return (resp.data.values?.[0] ?? []).map(v => (v ?? '').toString().trim());
  }

  async function getRows(
    arg?: string | { range?: string; limit?: number }
  ): Promise<string[][]> {
    let range = `${title}!A:Z`;
    let limit: number | undefined;

    if (typeof arg === 'string' && arg) {
      range = arg.includes('!') ? arg : `${title}!${arg}`;
    } else if (typeof arg === 'object' && arg !== null) {
      if (arg.range) {
        range = arg.range.includes('!') ? arg.range : `${title}!${arg.range}`;
      }
      if (typeof arg.limit === 'number') {
        limit = arg.limit;
      }
    }

    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = resp.data.values ?? [];
    return typeof limit === 'number' ? values.slice(0, Math.max(0, limit)) : values;
  }

  async function addRow(
    valuesOrRecord: (string | number | null)[] | Record<string, any>
  ) {
    // If it's an object, map it to the header order
    let row: (string | number | null)[];

    if (Array.isArray(valuesOrRecord)) {
      row = valuesOrRecord;
    } else if (valuesOrRecord && typeof valuesOrRecord === 'object') {
      const header = await fetchHeader();
      // Build a row aligning to the header columns (exact header text match)
      row = header.map(h => {
        const v = (valuesOrRecord as Record<string, any>)[h];
        if (v === undefined) return null;
        if (v === null) return null;
        if (typeof v === 'number') return v;
        return v.toString();
      });
    } else {
      throw new Error('addRow expects an array of values or a record object');
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${title}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  }

  return { sheets, spreadsheetId, sheetId, title, getRows, addRow };
}
