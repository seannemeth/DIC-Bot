// src/commands/setteam_bulk.ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { getGoogleAuthClient } from '../lib/googleAuth';

const prisma = new PrismaClient();

const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
  process.env.GOOGLE_SHEET_ID?.trim() ||
  process.env.SHEET_ID?.trim() ||
  '';

const TAB = (process.env.COACHES_TAB_NAME || 'Coaches').trim();
/**
 * Expected columns in Coaches tab (case-insensitive, flexible spacing):
 * DiscordId | Handle | Team | Conference | (optional) Coins
 * Only "Team" is required. Coins defaults to 500 if missing/invalid.
 */

function norm(v: unknown) { return String(v ?? '').trim(); }
function keyify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ''); }

// header aliases → canonical keys we care about
const aliases: Record<string, 'team' | 'coins' | 'ignore'> = {
  team: 'team', school: 'team', program: 'team', name: 'team',
  coins: 'coins', balance: 'coins', startingcoins: 'coins', startcoins: 'coins',
  // we ignore these for now (not in schema):
  discordid: 'ignore', handle: 'ignore', coach: 'ignore', conference: 'ignore',
};

function mapHeader(header: string[]) {
  const map: Partial<Record<'team'|'coins', number>> = {};
  header.forEach((h, i) => {
    const a = aliases[keyify(h)] ?? 'ignore';
    if (a !== 'ignore' && map[a] == null) map[a] = i;
  });
  const hasTeam = map.team != null;
  return { map, hasTeam };
}

// Clean up team strings like "TCU(jak1741)" -> "TCU", collapse spaces, trim.
function sanitizeTeam(raw: string) {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('setteam_bulk')
    .setDescription('Bulk create/update coaches from the Coaches sheet and set starting coins'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    if (!SPREADSHEET_ID) {
      await interaction.editReply('❌ Missing spreadsheet id. Set GOOGLE_SHEETS_SPREADSHEET_ID (or GOOGLE_SHEET_ID).');
      return;
    }

    try {
      const auth = await getGoogleAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });

      // Verify tab
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const tabs = (meta.data.sheets ?? []).map(s => s.properties?.title).filter(Boolean) as string[];
      const foundTab = tabs.find(t => t?.toLowerCase().trim() === TAB.toLowerCase());
      if (!foundTab) {
        await interaction.editReply(`❌ Tab **${TAB}** not found. Available:\n• ${tabs.join('\n• ')}`);
        return;
      }

      // Read values
      const range = `${foundTab}!A:Z`;
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
      const all = (resp.data.values ?? []).map(r => r.map(norm));

      // Skip leading empty rows
      let first = 0;
      while (first < all.length && all[first].every(c => !c)) first++;
      if (first >= all.length) {
        await interaction.editReply(`No rows found in **${foundTab}**.`);
        return;
      }

      const header = all[first];
      const { map, hasTeam } = mapHeader(header);
      if (!hasTeam) {
        await interaction.editReply(
          `❌ Header must include a Team column (aliases: Team/School/Program/Name). Got: ${JSON.stringify(header)}`
        );
        return;
      }

      const data = all.slice(first + 1).filter(r => r.some(c => !!c));

      let upserts = 0, wallets = 0, skipped = 0;
      const samples: string[] = [];

      for (const r of data) {
        const teamRaw = map.team != null ? norm(r[map.team]) : '';
        const team = sanitizeTeam(teamRaw);
        if (!team) { skipped++; continue; }

        const coinsRaw = map.coins != null ? norm(r[map.coins]) : '';
        const coinsNum = Number(coinsRaw);
        const coins = Number.isFinite(coinsNum) ? Math.trunc(coinsNum) : 500;

        // Upsert coach by team (team is unique in your schema)
        const coach = await prisma.coach.upsert({
          where: { team },
          update: {}, // nothing else in current schema
          create: { team },
        });
        upserts++;

        // Ensure wallet exists and set desired balance
        await prisma.wallet.upsert({
          where: { coachId: coach.id as any },
          create: { coachId: coach.id as any, balance: coins, season: 1 },
          update: { balance: { set: coins } },
        });
        wallets++;

        if (samples.length < 6) samples.push(`${team} • coins=${coins}`);
      }

      await interaction.editReply(
        `✅ Bulk teams set from **${foundTab}**: coaches upserted=${upserts}, wallets set=${wallets}, skipped=${skipped}/${data.length}\n` +
        (samples.length ? `Sample: ${samples.join(' | ')}` : '')
      );
    } catch (e: any) {
      console.error('[setteam_bulk] failed:', e);
      await interaction.editReply(`❌ Bulk set failed: ${e?.message || e}`);
    }
  },
} as const;
