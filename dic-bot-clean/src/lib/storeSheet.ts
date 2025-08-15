// src/lib/storeSheet.ts
import { PrismaClient } from '@prisma/client';
import { openSheetByTitle } from './googleAuth';

const prisma = new PrismaClient();

export async function refreshStoreFromSheet() {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const tab = await openSheetByTitle(sheetId, 'Store');
  const rows: any[] = await tab.getRows();

  for (const r of rows) {
    const key = String(r.ItemId ?? '').trim();
    if (!key) continue;

    // Normalize and guard enum string (let Prisma validate at runtime)
    const typeStr = String(r.Type ?? 'TOKEN').toUpperCase();
    const valid = ['COINS', 'ATTR', 'TOKEN'] as const;
    const type = (valid as readonly string[]).includes(typeStr) ? typeStr : 'TOKEN';

    const data: any = {
      itemKey: key,
      name: String(r.Name ?? key),
      description: r.Description ? String(r.Description) : null,
      price: Number(r.Price ?? 0) || 0,
      type, // keep as string; Prisma will coerce/validate against enum
      payload: safeJSON(r.PayloadJSON),
      enabled: String(r.Enabled ?? 'TRUE').toUpperCase() !== 'FALSE',
    };

    await prisma.item.upsert({
      where: { itemKey: data.itemKey },
      create: data as any,
      update: data as any,
    });
  }
}

function safeJSON(s: any) {
  if (!s) return {};
  try {
    return JSON.parse(String(s));
  } catch {
    return {};
  }
}
