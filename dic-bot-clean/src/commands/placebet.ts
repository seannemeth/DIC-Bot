// src/commands/placebet.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { openSheetByTitle } from '../lib/googleAuth';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Helpers
type LineRow = {
  GameId: string;
  Season: string | number;
  Week: string | number;
  HomeTeam: string;
  AwayTeam: string;
  Spread?: string | number;
  SpreadOdds?: string | number;
  Total?: string | number;
  TotalOdds?: string | number;
  HomeML?: string | number;
  AwayML?: string | number;
  Cutoff?: string;
};

async function getLines(): Promise<LineRow[]> {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const sheet = await openSheetByTitle(sheetId, 'Lines');
  const rows: any[] = await sheet.getRows();
  return rows.map((r: any) => ({
    GameId: String(r.GameId ?? ''),
    Season: r.Season,
    Week: r.Week,
    HomeTeam: r.HomeTeam,
    AwayTeam: r.AwayTeam,
    Spread: r.Spread,
    SpreadOdds: r.SpreadOdds,
    Total: r.Total,
    TotalOdds: r.TotalOdds,
    HomeML: r.HomeML,
    AwayML: r.AwayML,
    Cutoff: r.Cutoff,
  }));
}

function toNumber(x: any, fallback?: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function nowUtcISO() {
  return new Date().toISOString();
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('placebet')
    .setDescription('Place a bet on a listed game')
    // Dynamic game picker via autocomplete (value = GameId)
    .addStringOption(o =>
      o
        .setName('game')
        .setDescription('Pick a game (from /lines)')
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addStringOption(o =>
      o
        .setName('market')
        .setDescription('Bet type')
        .addChoices(
          { name: 'Spread', value: 'SPREAD' },
          { name: 'Total', value: 'TOTAL' },
          { name: 'Moneyline', value: 'ML' },
        )
        .setRequired(true),
    )
    .addStringOption(o =>
      o
        .setName('selection')
        .setDescription('Your side')
        .addChoices(
          { name: 'HOME', value: 'HOME' },
          { name: 'AWAY', value: 'AWAY' },
          { name: 'OVER (for Total)', value: 'OVER' },
          { name: 'UNDER (for Total)', value: 'UNDER' },
        )
        .setRequired(true),
    )
    .addIntegerOption(o =>
      o
        .setName('stake')
        .setDescription('DIC$ to risk')
        .setMinValue(1)
        .setRequired(true),
    ),

  // ---------- AUTOCOMPLETE: builds choices from the Lines sheet ----------
  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'game') return;
    try {
      const rows = await getLines();
      const q = String(focused.value || '').toLowerCase();

      // Build label like "S1 W1: Georgia vs Alabama  (ID 1)"
      // Limit to 25 choices (Discord max)
      const choices = rows
        .filter(r => r.GameId) // must have an ID
        .map(r => {
          const season = r.Season ?? '?';
          const week = r.Week ?? '?';
          const label = `S${season} W${week}: ${r.HomeTeam} vs ${r.AwayTeam} (ID ${r.GameId})`;
          return { name: label, value: String(r.GameId) };
        })
        .filter(c => c.name.toLowerCase().includes(q))
        .slice(0, 25);

      await interaction.respond(choices.length ? choices : [{ name: 'No matches', value: 'NONE' }]);
    } catch (e) {
      await interaction.respond([{ name: 'Error reading Lines', value: 'NONE' }]);
    }
  },

  // ---------- EXECUTE: validates balance, odds, cutoff; writes Wagers; debits wallet ----------
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const gameId = interaction.options.getString('game', true);
    const market = interaction.options.getString('market', true) as 'SPREAD' | 'TOTAL' | 'ML';
    const selection = interaction.options.getString('selection', true) as 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
    const stake = interaction.options.getInteger('stake', true);

    if (gameId === 'NONE') {
      await interaction.editReply('❌ Please pick a valid game from the list.');
      return;
    }

    // Find user/coach + wallet
    const discordId = interaction.user.id;
    const coach = await prisma.coach.findUnique({ where: { discordId } });
    if (!coach) {
      await interaction.editReply('❌ You must set up first with `/setteam`.');
      return;
    }
    const wallet = await prisma.wallet.upsert({
      where: { coachId: coach.id },
      create: { coachId: coach.id, balance: 500 }, // initial if not exists
      update: {},
    });
    if (wallet.balance < stake) {
      await interaction.editReply(`❌ Not enough DIC$. Your balance is ${wallet.balance}.`);
      return;
    }

    // Fetch the selected game from Lines
    const rows = await getLines();
    const row = rows.find(r => String(r.GameId) === String(gameId));
    if (!row) {
      await interaction.editReply('❌ Game not found in Lines sheet.');
      return;
    }

    // Check cutoff
    if (row.Cutoff) {
      const cutoffMs = Date.parse(row.Cutoff);
      if (!Number.isNaN(cutoffMs) && Date.now() > cutoffMs) {
        await interaction.editReply('⛔ Betting closed for this game.');
        return;
      }
    }

    // Determine odds + line for the chosen market
    let usedOdds = -110; // default
    let usedLine: number | undefined = undefined;

    if (market === 'SPREAD') {
      usedLine = toNumber(row.Spread);
      usedOdds = toNumber(row.SpreadOdds, -110)!;
      if (!Number.isFinite(usedLine!)) {
        await interaction.editReply('❌ No spread available for this game.');
        return;
      }
      if (selection !== 'HOME' && selection !== 'AWAY') {
        await interaction.editReply('❌ For SPREAD, selection must be HOME or AWAY.');
        return;
      }
    } else if (market === 'TOTAL') {
      usedLine = toNumber(row.Total);
      usedOdds = toNumber(row.TotalOdds, -110)!;
      if (!Number.isFinite(usedLine!)) {
        await interaction.editReply('❌ No total available for this game.');
        return;
      }
      if (selection !== 'OVER' && selection !== 'UNDER') {
        await interaction.editReply('❌ For TOTAL, selection must be OVER or UNDER.');
        return;
      }
    } else if (market === 'ML') {
      if (selection === 'HOME') usedOdds = toNumber(row.HomeML, -110)!;
      else if (selection === 'AWAY') usedOdds = toNumber(row.AwayML, -110)!;
      else {
        await interaction.editReply('❌ For ML, selection must be HOME or AWAY.');
        return;
      }
    }

    const season = Number(row.Season) || 0;
    const week = Number(row.Week) || 0;
    const homeTeam = row.HomeTeam;
    const awayTeam = row.AwayTeam;

    // Write to Wagers sheet, debit DB wallet
    try {
      // Sheets write
      const sheetId = process.env.GOOGLE_SHEET_ID || '';
      const wagersSheet = await openSheetByTitle(sheetId, 'Wagers');
      const betId = `${Date.now()}_${discordId.slice(-4)}`;
      const ts = nowUtcISO();

      await wagersSheet.addRow({
        TimestampUTC: ts,
        DiscordId: discordId,
        CoachId: coach.id,
        Season: season,
        Week: week,
        HomeTeam: homeTeam,
        AwayTeam: awayTeam,
        Market: market,
        Selection: selection,
        Line: usedLine ?? '',
        Odds: usedOdds,
        Stake: stake,
        Status: 'PENDING',
        Result: '',
        Payout: '',
        BetId: betId,
        MessageLink: '', // you can fill with interaction.url if you echo in a public channel
      });

      // DB debit
      await prisma.wallet.update({
        where: { coachId: coach.id },
        data: { balance: { decrement: stake } },
      });

      const oddsStr = usedOdds > 0 ? `+${usedOdds}` : `${usedOdds}`;
      const lineStr =
        market === 'SPREAD' ? `Spread ${usedLine!} (${selection})` :
        market === 'TOTAL' ? `Total ${usedLine!} (${selection})` :
        `Moneyline (${selection})`;

      await interaction.editReply(
        `✅ Bet placed: **${homeTeam} vs ${awayTeam}** — ${lineStr} @ ${oddsStr}\n` +
        `Stake: **${stake} DIC$** • Game: S${season} W${week} • BetId: \`${betId}\``
      );
    } catch (e: any) {
      console.error('[placebet] error:', e);
      await interaction.editReply('⚠️ Could not record your bet. Try again in a minute.');
    }
  },
} as const;
