// src/lib/storeSheet.ts
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { getGoogleAuthClient } from './googleAuth';

const TAB = (process.env.STORE_TAB_NAME || 'Store').trim();
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
  process.env.GOOGLE_SHEET_ID?.trim() ||
  process.env.SHEET_ID?.trim() ||
  '';

const prisma = new PrismaClient();

function norm(v: unknown) { return String(v ?? '').trim(); }
function keyify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ''); }

const aliases: Record<string, 'itemkey'|'name'|'price'|'type'|'description'|'enabled'|'payload'> = {
  itemkey: 'itemkey', item: 'itemkey', key: 'itemkey',
  name: 'name', title: 'name',
  price: 'price', cost: 'price',
  type: 'type', kind: 'type',
  description: 'description', desc: 'description',
  enabled: 'enabled', active: 'enabled', enabledq: 'enabled',
  payload: 'payload', json: 'payload', data: 'payload', meta: 'payload'
};

function mapHeader(header: string[]) {
  const map: Partial<Record<'itemkey'|'name'|'price'|'type'|'description'|'enabled'|'payload', number>> = {};
  header.forEach((h, i) => {
    const aliased = aliases[keyify(h) as keyof typeof aliases];
    if (aliased && map[aliased] == null) map[aliased] = i;
  });
  const requiredPresent = map.itemkey != null && map.name != null && map.price != null;
  return { map, requiredPresent };
}

function parseBool(s: string): boolean | undefined {
  const k = keyify(s);
  if (!k) return undefined;
  if (['true','1','yes','y','on'].includes(k)) return true;
  if (['false','0','no','n','off'].includes(k)) return false;
  return undefined;
}

// Normalize type text from sheet -> plain string (fallback 'TOKEN')
// If your DB expects specific strings, list them below.
function parseType(s: string): string {
  const t = keyify(s).toUpperCase(); // keyify() lowers; then upper
  if (t === 'COINS') return 'COINS';
  if (t === 'ATTR')  return 'ATTR';
  if (t === 'TOKEN') return 'TOKEN';
  // fallback
  return 'TOKEN';
}

export type StoreSyncResult = {
  upserts: number;
  skipped: number;
  totalRows: number;
  diag: string;
};

export async function syncStoreFromSheet(): Promise<StoreSyncResult> {
  if (!SPREADSHEET_ID) {
    throw new Error('Missing spreadsheet id. Set GOOGLE_SHEETS_SPREADSHEET_ID (or GOOGLE_SHEET_ID).');
  }
  const auth = await getGoogleAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // Verify tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tabs = (meta.data.sheets ?? []).map(s => s.properties?.title).filter(Boolean) as string[];
  const foundTab = tabs.find(t => t!.toLowerCase().trim() === TAB.toLowerCase());
  if (!foundTab) throw new Error(`Tab "${TAB}" not found. Available: ${tabs.join(', ')}`);

  // Read rows
  const range = `${foundTab}!A:Z`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const all = (resp.data.values ?? []).map(row => row.map(norm));

  // Skip leading empties
  let firstIdx = 0;
  while (firstIdx < all.length && all[firstIdx].every(c => !c)) firstIdx++;
  if (firstIdx >= all.length) return { upserts: 0, skipped: 0, totalRows: 0, diag: 'Sheet is empty' };

  const header = all[firstIdx];
  const { map, requiredPresent } = mapHeader(header);
  if (!requiredPresent) {
    return {
      upserts: 0, skipped: 0, totalRows: 0,
      diag: `Missing required headers. Need itemKey, name, price. Header: ${JSON.stringify(header)}`
    };
  }

  const data = all.slice(firstIdx + 1).filter(r => r.some(c => !!c));
  let upserts = 0, skipped = 0;
  const samples: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const itemKey = norm(r[map.itemkey!]);
    const name = norm(r[map.name!]);
    const priceRaw = norm(r[map.price!]);
    const typeRaw = map.type != null ? norm(r[map.type]) : '';
    const description = map.description != null ? norm(r[map.description]) : '';
    const enabledRaw = map.enabled != null ? norm(r[map.enabled]) : '';
    const payloadRaw = map.payload != null ? norm(r[map.payload]) : '';

    const price = Number(priceRaw);
    if (!itemKey || !name || !Number.isFinite(price)) { skipped++; continue; }

    const enabled = parseBool(enabledRaw);
    const type = parseType(typeRaw); // now plain string

    let payload: any = undefined;
    if (payloadRaw) {
      try { payload = JSON.parse(payloadRaw); } catch { /* ignore bad JSON */ }
    }

    if (samples.length < 5) {
      samples.push(`${itemKey} • ${name} • ${price} • ${type} • enabled=${enabled ?? true}`);
    }

    await prisma.item.upsert({
      where: { itemKey },
      update: {
        name,
        price: Math.trunc(price),
        type, // string
        description: description || null,
        enabled: enabled ?? true,
        payload,
      },
      create: {
        itemKey,
        name,
        price: Math.trunc(price),
        type, // string
        description: description || null,
        enabled: enabled ?? true,
        payload,
      },
    });
    upserts++;
  }

  return {
    upserts, skipped, totalRows: data.length,
    diag: `Tab: ${foundTab} • Parsed samples: ${samples.join(' | ') || '(none)'}`
  };
}

export { syncStoreFromSheet as refreshStoreFromSheet };
