// src/commands/powerrankings.ts
import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { getCurrentSeasonWeek } from '../lib/meta';

const prisma = new PrismaClient();

// --- Elo settings (tweak if you like) ---
const BASE_ELO = 1500;
const K = 24;               // update factor
const HOME_ADV = 40;        // home-advantage points added to home team's Elo in prediction
// ----------------------------------------

type EloTable = Map<string, number>;

function getElo(table: EloTable, team: string): number {
  const t = team.trim();
  if (!table.has(t)) table.set(t, BASE_ELO);
  return table.get(t)!;
}

function setElo(table: EloTable, team: string, value: number) {
  table.set(team.trim(), value);
}

function expectedScore(rA: number, rB: number): number {
  // standard Elo expected score
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

function movMultiplier(margin: number, eloDiff: number): number {
  // Margin-of-victory multiplier (popular Elo variant)
  // Source idea: 2.2 / ( (eloDiff * 0.001) + 2.2 )
  return Math.log(Math.max(1, margin + 1)) * (2.2 / ((eloDiff * 0.001) + 2.2));
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('powerrankings')
    .setDescription('Elo-based power rankings from recorded scores')
    .addIntegerOption(o =>
      o.setName('season').setDescription('Season to show (defaults to current)')
    )
    .addIntegerOption(o =>
      o.setName('thru_week').setDescription('Include games up to this week (defaults to current week)')
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const seasonOpt = interaction.options.getInteger('season', false) ?? null;
    const thruWeekOpt = interaction.options.getInteger('thru_week', false) ?? null;

    const { season: curSeason, week: curWeek } = await getCurrentSeasonWeek();
    const season = seasonOpt ?? curSeason;
    const thruWeek = thruWeekOpt ?? curWeek;

    // Pull scored games for the season up to thruWeek (inclusive)
    const games = await prisma.game.findMany({
      where: {
        season,
        week: { lte: thruWeek },
        AND: [{ homePts: { not: null } }, { awayPts: { not: null } }],
      },
      orderBy: [{ week: 'asc' }, { id: 'asc' }],
    });

    if (!games.length) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Season ${season} — Power Rankings`)
            .setDescription('No scored games found yet.')
            .setColor(0x95a5a6),
        ],
      });
      return;
    }

    // Build team set from games
    const teams = new Set<string>();
    for (const g of games) {
      teams.add(g.homeTeam.trim());
      teams.add(g.awayTeam.trim());
    }

    // Initialize Elo table
    const elo: EloTable = new Map();
    for (const t of teams) setElo(elo, t, BASE_ELO);

    // Play through games in order
    for (const g of games) {
      const home = g.homeTeam.trim();
      const away = g.awayTeam.trim();
      const hPts = Number(g.homePts);
      const aPts = Number(g.awayPts);

      let rH = getElo(elo, home);
      let rA = getElo(elo, away);

      // Expected with home advantage
      const expH = expectedScore(rH + HOME_ADV, rA);
      const expA = 1 - expH;

      // Actual score
      let sH = 0.5, sA = 0.5;
      if (hPts > aPts) { sH = 1; sA = 0; }
      else if (hPts < aPts) { sH = 0; sA = 1; }

      // Margin of victory (absolute)
      const margin = Math.abs(hPts - aPts);
      const mult = movMultiplier(margin, Math.abs(rH - rA));

      // Elo updates
      rH = rH + K * mult * (sH - expH);
      rA = rA + K * mult * (sA - expA);

      setElo(elo, home, rH);
      setElo(elo, away, rA);
    }

    // Sort by Elo
    const rows = Array.from(elo.entries())
      .map(([team, rating]) => ({ team, rating }))
      .sort((a, b) => b.rating - a.rating);

    // Prepare display (top 20 or all if <= 20)
    const top = rows.slice(0, Math.max(20, rows.length));
    const avg = rows.reduce((acc, r) => acc + r.rating, 0) / rows.length;
    const lines = top.map((r, i) => {
      const diff = r.rating - BASE_ELO;
      const arrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '→');
      return `**${i + 1}. ${r.team}** — ${r.rating.toFixed(1)} (${arrow} ${diff >= 0 ? '+' : ''}${diff.toFixed(1)})`;
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Season ${season} — Power Rankings (thru Week ${thruWeek})`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `Teams: ${rows.length} • Avg Elo: ${avg.toFixed(1)} • K=${K}, HAdv=${HOME_ADV}` })
          .setColor(0x9b59b6),
      ],
    });
  },
} as const;
