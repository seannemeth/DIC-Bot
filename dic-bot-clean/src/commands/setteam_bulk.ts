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
 * Expected columns in Coaches tab (case-insensitive):
 * DiscordId | Handle | Team | Conference | (optional) Coins
 * Required: DiscordId, Team
 * Optional: Coins (defaults to 500)
 */

function norm(v: unknown) { return String(v ?? '').trim(); }
function keyify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ''); }

// Map header -> canonical keys we use
type Canon = 'discordid' | 'team' | 'coins' | 'ignore';
const aliases: Record<string, Canon> = {
  // required
  discordid: 'discordid', userid: 'discordid', user: 'discordid', id: 'discordid',
  // required
  team: 'team', school: 'team', program: 'team', name: 'team',
  // optional
  coins: 'coins', balance: 'coins', startingcoins: 'coins', startcoins: 'coins',
  // ignored for now
  handle: 'ignore', coach: 'ignore', username: 'ignore', conference: 'ignore',
};

function mapHeader(header: string[]) {
  const map: Partial<Record<'discordid'|'team'|'coins', number>> = {};
  header.forEach((h, i) => {
    const a = aliases[keyify(h)] ?? 'ignore';
    if (a !== 'ignore' && map[a as 'discordid'|'team'|'coins'] == null) {
      map[a as 'discordid'|'team'|'coins'] = i;
    }
  });
  const hasDiscord = map.discordid != null;
  const hasTeam = map.team != null;
  return { map, hasDiscord, hasTeam };
}

// Clean team strings like "TCU(jak1741)" -> "TCU"
function sanitizeTeam(raw: string) {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Team alias handling so schedule/standings/wallets all use one canonical team name.
 * We canonicalize to lowercase keys, then pick a preferred display name.
 */
const TEAM_ALIASES: Record<string, string> = {
  'pitt': 'pittsburgh',
  'penn st': 'penn state',
  'miss state': 'mississippi state',
  'oklahoma st': 'oklahoma state',
  'kansas st': 'kansas state',
  'nc state': 'north carolina state',
  'louisiana st': 'lsu',
  'ucla': 'ucla', // example of already-canonical short name
  // add more as needed
};

const DISPLAY_NAME: Record<string, string> = {
  'pittsburgh': 'Pittsburgh',
  'penn state': 'Penn State',
  'mississippi state': 'Mississippi State',
  'oklahoma state': 'Oklahoma State',
  'kansas state': 'Kansas State',
  'north carolina state': 'NC State',
  'lsu': 'LSU',
  // If a canonical key isn't here, we'll fall back to the sanitized input.
};

function canonTeam(raw: string) {
  const s = sanitizeTeam(raw)
    .replace(/\./g, '')    // remove periods (e.g., "St.")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // exact alias
  if (TEAM_ALIASES[s]) return TEAM_ALIASES[s];

  // loose "st" -> "state" rule, after alias check
  if (s.endsWith(' st')) return s.replace(/ st$/, ' state');

  return s;
}

function displayTeam(raw: string) {
  const c = canonTeam(raw);
  return DISPLAY_NAME[c] ?? sanitizeTeam(raw);
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

      // Skip leading empties
      let first = 0;
      while (first < all.length && all[first].every(c => !c)) first++;
      if (first >= all.length) {
        await interaction.editReply(`No rows found in **${foundTab}**.`);
        return;
      }

      const header = all[first];
      const { map, hasDiscord, hasTeam } = mapHeader(header);
      if (!hasDiscord || !hasTeam) {
        await interaction.editReply(
          `❌ Header must include **DiscordId** and **Team**.\n` +
          `Got: ${JSON.stringify(header)}`
        );
        return;
      }

      const data = all.slice(first + 1).filter(r => r.some(c => !!c));

      let upserts = 0, wallets = 0, skipped = 0, failed = 0;
      const samples: string[] = [];
      const seen = new Set<string>(); // avoid duplicate discordIds in one run

      for (const r of data) {
        const discordId = norm(r[map.discordid!]);
        const teamRaw = norm(r[map.team!]);
        const teamDisplay = displayTeam(teamRaw); // normalized for consistent naming

        if (!discordId || !teamDisplay) { skipped++; continue; }
        if (seen.has(discordId)) { skipped++; continue; }
        seen.add(discordId);

        const coinsRaw = map.coins != null ? norm(r[map.coins]) : '';
        let coins = Number.parseInt(coinsRaw, 10);
        if (!Number.isFinite(coins)) coins = 500;
        if (coins < 0) coins = 0;

        try {
          // Upsert coach BY discordId (required by your schema), set team
          const coach = await prisma.coach.upsert({
            where: { discordId },
            update: { team: teamDisplay },
            create: { discordId, team: teamDisplay },
          });
          upserts++;

          // Ensure wallet exists & set balance to Coins
          // NOTE: This assumes Wallet.coachId is unique (one wallet per coach).
          // If you use (coachId, season) composite unique instead, swap to where: { coachId_season: { coachId: coach.id, season: 1 } }
          await prisma.wallet.upsert({
            where: { coachId: coach.id },
            create: { coachId: coach.id, balance: coins, season: 1 },
            update: { balance: { set: coins } },
          });
          wallets++;

          if (samples.length < 6) samples.push(`${discordId} • ${teamDisplay} • coins=${coins}`);
        } catch (err) {
          failed++;
          console.error(`[setteam_bulk] row failed for ${discordId} (${teamDisplay}):`, err);
        }
      }

      await interaction.editReply(
        `✅ Bulk teams set from **${foundTab}**\n` +
        `• coaches upserted=${upserts}\n` +
        `• wallets set=${wallets}\n` +
        `• skipped=${skipped}/${data.length}\n` +
        (failed ? `• failed=${failed}\n` : '') +
        (samples.length ? `Sample: ${samples.join(' | ')}` : '')
      );
    } catch (e: any) {
      console.error('[setteam_bulk] failed:', e);
      await interaction.editReply(`❌ Bulk set failed: ${e?.message || e}`);
    }
  },
} as const;
