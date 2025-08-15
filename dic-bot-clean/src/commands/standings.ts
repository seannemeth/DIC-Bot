// src/commands/standings.ts
import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { getCurrentSeasonWeek } from '../lib/meta';

const prisma = new PrismaClient();

type TeamRow = {
  team: string;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  diff: number;
};

function pct(r: TeamRow) {
  const g = r.w + r.l + r.t;
  return g ? (r.w + 0.5 * r.t) / g : 0;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show standings based on recorded scores')
    .addIntegerOption(o =>
      o.setName('season').setDescription('Season to show (defaults to current)')
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    // season filter (default: current season)
    const seasonOpt = interaction.options.getInteger('season', false) ?? null;
    const season = seasonOpt ?? (await getCurrentSeasonWeek()).season;

    // Pull all games with scores for the season
    const games = await prisma.game.findMany({
      where: { season, AND: [{ homePts: { not: null } }, { awayPts: { not: null } }] },
      orderBy: [{ week: 'asc' }, { homeTeam: 'asc' }, { awayTeam: 'asc' }],
    });

    if (games.length === 0) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Season ${season} — Standings`)
            .setDescription('No scored games found yet.')
            .setColor(0x95a5a6),
        ],
        ephemeral: false,
      });
      return;
    }

    // Build the universe of teams from games (no reliance on coach links)
    const teams = new Set<string>();
    for (const g of games) {
      teams.add(g.homeTeam.trim());
      teams.add(g.awayTeam.trim());
    }

    // Initialize table keyed by team name
    const table = new Map<string, TeamRow>();
    for (const t of teams) {
      table.set(t, { team: t, w: 0, l: 0, t: 0, pf: 0, pa: 0, diff: 0 });
    }

    // Aggregate results
    for (const g of games) {
      const home = table.get(g.homeTeam.trim())!;
      const away = table.get(g.awayTeam.trim())!;
      const h = Number(g.homePts);
      const a = Number(g.awayPts);

      home.pf += h; home.pa += a; home.diff += (h - a);
      away.pf += a; away.pa += h; away.diff += (a - h);

      if (h > a) { home.w++; away.l++; }
      else if (h < a) { away.w++; home.l++; }
      else { home.t++; away.t++; }
    }

    // Sort by win%, then point diff, then PF
    const rows = Array.from(table.values()).sort((x, y) => {
      const px = pct(x), py = pct(y);
      if (py !== px) return py - px;
      if (y.diff !== x.diff) return y.diff - x.diff;
      return (y.pf - y.pa) - (x.pf - x.pa);
    });

    const lines = rows.map((r, i) => {
      const gamesPlayed = r.w + r.l + r.t;
      const pctDisp = gamesPlayed ? pct(r).toFixed(3).replace(/^0/, '') : '-';
      return `**${i + 1}. ${r.team}**  ${r.w}-${r.l}${r.t ? '-' + r.t : ''}  (PF ${r.pf} / PA ${r.pa} / Diff ${r.diff})  •  ${pctDisp}`;
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Season ${season} — Standings`)
          .setDescription(lines.join('\n'))
          .setColor(0x3498db),
      ],
      ephemeral: false,
    });
  },
} as const;
