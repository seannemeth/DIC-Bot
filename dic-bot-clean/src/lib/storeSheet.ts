// src/lib/storeSheet.ts
import { PrismaClient, Prisma, $Enums } from '@prisma/client';
import { openSheetByTitle } from './googleAuth';
const prisma = new PrismaClient();

export async function refreshStoreFromSheet() {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const tab = await openSheetByTitle(sheetId, 'Store');
  const rows: any[] = await tab.getRows();

  for (const r of rows) {
    const key = String(r.ItemId ?? '').trim();
    if (!key) continue;

    const typeStr = String(r.Type ?? 'TOKEN').toUpperCase();
    // Accept only valid enum values; fallback to TOKEN
    const valid: Array<$Enums.ItemType> = ['COINS', 'ATTR', 'TOKEN'];
    const type: $Enums.ItemType = (valid.includes(typeStr as $Enums.ItemType)
      ? (typeStr as $Enums.ItemType)
      : 'TOKEN');

    const data = {
      itemKey: key,
      name: String(r.Name ?? key),
      description: r.Description ? String(r.Description) : null,
      price: Number(r.Price ?? 0) || 0,
      type,
      payload: safeJSON(r.PayloadJSON),
      enabled: String(r.Enabled ?? 'TRUE').toUpperCase() !== 'FALSE',
    } satisfies Prisma.ItemUncheckedCreateInput;

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
