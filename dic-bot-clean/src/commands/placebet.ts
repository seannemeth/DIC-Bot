// src/commands/placebet.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { openSheetByTitle } from '../lib/googleAuth';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

type LineRow = {
  GameId?: string;
  Season?: string | number;
  Week?: string | number;
  HomeTeam?: string;
  AwayTeam?: string;
  Spread?: string | number;
  SpreadOdds?: string | number;
  Total?: string | number;
  TotalOdds?: string | number;
  HomeML?: string | number;
  AwayML?: string | number;
  Cutoff?: string;
  _key: string;      // S|W|Home|Away
  _label: string;    // "S1 W1: Home vs Away (ID ...)"
  _value: string;    // "ID:123" or "KEY:S|W|Home|Away"
};

async function getLines(): Promise<LineRow[]> {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set');

  const sheet = await openSheetByTitle(sheetId, 'Lines');
  const rows: any[] = await sheet.getRows();

  const out: LineRow[] = rows.map((r: any) => {
    const season = r.Season ?? '';
    const week = r.Week ?? '';
    const home = r.HomeTeam ?? '';
    const away = r.AwayTeam ?? '';
    const id = r.GameId ? String(r.GameId) : undefined;

    const key = `${season}|${week}|${home}|${away}`;
    const label = `S${season || '?'} W${week || '?'}: ${home || '?'} vs ${away || '?'}${id ? ` (ID ${id})` : ''}`;
    const value = id ? `ID:${id}` : `KEY:${key}`;

    return {
      GameId: id,
      Season: season,
      Week: week,
      HomeTeam: home,
      AwayTeam: away,
      Spread: r.Spread,
      SpreadOdds: r.SpreadOdds,
      Total: r.Total,
      TotalOdds: r.TotalOdds,
      HomeML: r.HomeML,
      AwayML: r.AwayML,
      Cutoff: r.Cutoff,
      _key: key,
      _label: label,
      _value: value,
    };
  });

  return out.filter(r => (r.HomeTeam || '').trim() && (r.AwayTeam || '').trim());
}

function toNumber(x: any, fallback?: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : (fallback as number | undefined);
}
function nowUtcISO() {
  return new Date().toISOString();
}
function resolveRowByValue(rows: LineRow[], val: string): LineRow | undefined {
  if (val.startsWith('ID:')) {
    const id = val.slice(3);
    return rows.find(r => (r.GameId ?? '') === id);
  } else if (val.startsWith('KEY:')) {
    const key = val.slice(4);
    return rows.find(r => r._key === key);
  }
  // fallback: treat as raw GameId
  return rows.find(r => (r.GameId ?? '') === val);
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('placebet')
    .setDescription('Place a bet on a listed game')
    // Dynamic game picker via autocomplete (value = ID:xxx or KEY:...)
    .addStringOption(o =>
      o
        .setName('game')
        .setDescription('Pick a game (from Lines)')
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
    // ✅ selection is now autocomplete so we can show team/number labels
    .addStringOption(o =>
      o
        .setName('selection')
        .setDescription('Your side (will show teams/lines)')
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addIntegerOption(o =>
      o
        .setName('stake')
        .setDescription('DIC$ to risk')
        .setMinValue(1)
        .setRequired(true),
    ),

  // ---------- AUTOCOMPLETE ----------
  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);

    try {
      // 1) GAME choices
      if (focused.name === 'game') {
        const q = String(focused.value || '').toLowerCase();
        const rows = await getLines();
        if (!rows.length) {
          await interaction.respond([{ name: 'No lines found (check sheet sharing & headers)', value: 'NONE' }]);
          return;
        }
        const choices = rows
          .filter(r =>
            !q ||
            r._label.toLowerCase().includes(q) ||
            String(r.Season ?? '').toLowerCase().includes(q) ||
            String(r.Week ?? '').toLowerCase().includes(q) ||
            (r.HomeTeam ?? '').toLowerCase().includes(q) ||
            (r.AwayTeam ?? '').toLowerCase().includes(q) ||
            (r.GameId ?? '').toLowerCase().includes(q)
          )
          .slice(0, 25)
          .map(r => ({ name: r._label, value: r._value }));
        await interaction.respond(choices.length ? choices : [{ name: 'No matches', value: 'NONE' }]);
        return;
      }

      // 2) SELECTION choices (needs market + game)
      if (focused.name === 'selection') {
        const market = interaction.options.getString('market') as 'SPREAD' | 'TOTAL' | 'ML' | null;
        const gameVal = interaction.options.getString('game');
        if (!market || !gameVal || gameVal === 'NONE') {
          await interaction.respond([{ name: 'Pick a game and market first', value: 'HOME' }]);
          return;
        }

        const rows = await getLines();
        const row = resolveRowByValue(rows, gameVal);
        if (!row) {
          await interaction.respond([{ name: 'Selected game not found', value: 'HOME' }]);
          return;
        }

        // Build context-aware labels
        const spread = toNumber(row.Spread);
        const spreadOdds = toNumber(row.SpreadOdds, -110);
        const total = toNumber(row.Total);
        const totalOdds = toNumber(row.TotalOdds, -110);
        const homeML = toNumber(row.HomeML);
        const awayML = toNumber(row.AwayML);
        const home = row.HomeTeam || 'Home';
        const away = row.AwayTeam || 'Away';

        if (market === 'SPREAD') {
          if (!Number.isFinite(spread)) {
            await interaction.respond([{ name: 'No spread for this game', value: 'HOME' }]);
            return;
          }
          const homeSpread = spread!; // from home perspective
          const awaySpread = -homeSpread;
          const oddsStr = (spreadOdds! > 0 ? `+${spreadOdds}` : `${spreadOdds}`);
          await interaction.respond([
            { name: `HOME (${home} ${homeSpread >= 0 ? '+' : ''}${homeSpread})  @ ${oddsStr}`, value: 'HOME' },
            { name: `AWAY (${away} ${awaySpread >= 0 ? '+' : ''}${awaySpread})  @ ${oddsStr}`, value: 'AWAY' },
          ]);
          return;
        }

        if (market === 'TOTAL') {
          if (!Number.isFinite(total)) {
            await interaction.respond([{ name: 'No total for this game', value: 'OVER' }]);
            return;
          }
          const oddsStr = (totalOdds! > 0 ? `+${totalOdds}` : `${totalOdds}`);
          await interaction.respond([
            { name: `OVER ${total}  @ ${oddsStr}`, value: 'OVER' },
            { name: `UNDER ${total}  @ ${oddsStr}`, value: 'UNDER' },
          ]);
          return;
        }

        if (market === 'ML') {
          const homeStr = homeML != null ? (homeML > 0 ? `+${homeML}` : `${homeML}`) : 'N/A';
          const awayStr = awayML != null ? (awayML > 0 ? `+${awayML}` : `${awayML}`) : 'N/A';
          await interaction.respond([
            { name: `HOME (${home} ML ${homeStr})`, value: 'HOME' },
            { name: `AWAY (${away} ML ${awayStr})`, value: 'AWAY' },
          ]);
          return;
        }

        // Fallback
        await interaction.respond([{ name: 'Select a market', value: 'HOME' }]);
        return;
      }

      // Unknown focused field
      await interaction.respond([]);
    } catch {
      await interaction.respond([{ name: 'Autocomplete error', value: 'NONE' }]);
    }
  },

  // ---------- EXECUTE ----------
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const gameVal = interaction.options.getString('game', true);
    const market = interaction.options.getString('market', true) as 'SPREAD' | 'TOTAL' | 'ML';
    const selection = interaction.options.getString('selection', true) as 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
    const stake = interaction.options.getInteger('stake', true);

    if (gameVal === 'NONE') {
      await interaction.editReply('❌ Please pick a valid game from the list.');
      return;
    }

    // User & wallet
    const discordId = interaction.user.id;
    const coach = await prisma.coach.findUnique({ where: { discordId } });
    if (!coach) {
      await interaction.editReply('❌ You must set up first with `/setteam`.');
      return;
    }
    const wallet = await prisma.wallet.upsert({
      where: { coachId: coach.id },
      create: { coachId: coach.id, balance: 500 },
      update: {},
    });
    if (wallet.balance < stake) {
      await interaction.editReply(`❌ Not enough DIC$. Your balance is ${wallet.balance}.`);
      return;
    }

    // Selected line row
    const rows = await getLines();
    const row = resolveRowByValue(rows, gameVal);
    if (!row) {
      await interaction.editReply('❌ Selected game not found in Lines sheet.');
      return;
    }

    // Cutoff
    if (row.Cutoff) {
      const cutoffMs = Date.parse(row.Cutoff);
      if (!Number.isNaN(cutoffMs) && Date.now() > cutoffMs) {
        await interaction.editReply('⛔ Betting closed for this game.');
        return;
      }
    }

    // Odds / line
    let usedOdds = -110;
    let usedLine: number | undefined;
    if (market === 'SPREAD') {
      usedLine = toNumber(row.Spread);
      usedOdds = toNumber(row.SpreadOdds, -110)!;
      if (!Number.isFinite(usedLine!)) return interaction.editReply('❌ No spread available for this game.');
      if (selection !== 'HOME' && selection !== 'AWAY') return interaction.editReply('❌ SPREAD needs HOME or AWAY.');
    } else if (market === 'TOTAL') {
      usedLine = toNumber(row.Total);
      usedOdds = toNumber(row.TotalOdds, -110)!;
      if (!Number.isFinite(usedLine!)) return interaction.editReply('❌ No total available for this game.');
      if (selection !== 'OVER' && selection !== 'UNDER') return interaction.editReply('❌ TOTAL needs OVER or UNDER.');
    } else if (market === 'ML') {
      if (selection === 'HOME') usedOdds = toNumber(row.HomeML, -110)!;
      else if (selection === 'AWAY') usedOdds = toNumber(row.AwayML, -110)!;
      else return interaction.editReply('❌ ML needs HOME or AWAY.');
    }

    const season = Number(row.Season) || 0;
    const week = Number(row.Week) || 0;
    const homeTeam = row.HomeTeam || 'Home';
    const awayTeam = row.AwayTeam || 'Away';

    // Append to Wagers + debit wallet
    try {
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
        MessageLink: '',
      });

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
      await interaction.editReply('⚠️ Could not record your bet. Check sheet sharing & headers, then try again.');
    }
  },
} as const;
