// src/lib/meta.ts
// Lightweight meta helpers with an in-memory cache.
// If you want persistence later, swap these to use a DB or a Google Sheet.

const cache: Record<string, string> = {};

// Generic getters/setters
export async function getMeta(key: string): Promise<string | null> {
  if (key in cache) return cache[key];
  const envKey = `META_${key.toUpperCase()}`;
  if (process.env[envKey]) return String(process.env[envKey]);
  return null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  cache[key] = value;
}

// Numeric helpers some commands expect
export async function getNumber(key: string, fallback = 1): Promise<number> {
  const raw = await getMeta(key);
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export async function setNumber(key: string, value: number): Promise<void> {
  await setMeta(key, String(value));
}

// Convenience for schedule-related commands
export async function getCurrentSeasonWeek(): Promise<{ season: number; week: number }> {
  const season = await getNumber('season', 1);
  const week = await getNumber('week', 1);
  return { season, week };
}
