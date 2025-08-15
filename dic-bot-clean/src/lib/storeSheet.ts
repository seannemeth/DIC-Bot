import { PrismaClient, ItemType } from '@prisma/client';
import { openSheetByTitle } from './googleAuth';
const prisma = new PrismaClient();

export async function refreshStoreFromSheet() {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const tab = await openSheetByTitle(sheetId, 'Store');
  const rows: any[] = await tab.getRows();

  for (const r of rows) {
    const key = String(r.ItemId ?? '').trim();
    if (!key) continue;

    const data = {
      itemKey: key,
      name: String(r.Name ?? key),
      description: r.Description ? String(r.Description) : null,
      price: Number(r.Price ?? 0) || 0,
      type: (String(r.Type ?? 'TOKEN').toUpperCase() as ItemType),
      payload: safeJSON(r.PayloadJSON),
      enabled: String(r.Enabled ?? 'TRUE').toUpperCase() !== 'FALSE',
    };

    await prisma.item.upsert({
      where: { itemKey: data.itemKey },
      create: data,
      update: data,
    });
  }
}

function safeJSON(s: any) {
  if (!s) return {};
  try { return JSON.parse(String(s)); } catch { return {}; }
}
