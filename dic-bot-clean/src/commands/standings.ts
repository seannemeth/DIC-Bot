// src/commands/standings.ts
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { PrismaClient, GameStatus } from '@prisma/client';

const prisma = new PrismaClient();

type Rec = {
  id: string;
  team: string;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  diff: number;
};

export const command = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show overall standings'),
  async execute(interaction: any) {
    // pull coaches and only confirmed games
    const teams = await prisma.coach.findMany();
    const games = await prisma.game.findMany({ where: { status: GameStatus.confirmed } });

    // seed table
    const table: Rec[] = teams.map((t: any) => ({
      id: t.id as string,
      team: (t.team ?? '').toString(),
      w: 0,
      l: 0,
      t: 0,
      pf: 0,
      pa: 0,
      diff: 0,
    }));

    // quick lookup by coach id (string)
    const lookup = new Map<string, Rec>(table.map((r) => [r.id, r]));

    // aggregate results
    for (const g of games) {
      if (g.homePts == null || g.awayPts == null) continue;

      const h = g.homeCoachId ? lookup.get(g.homeCoachId) : undefined;
      const a = g.awayCoachId ? lookup.get(g.awayCoachId) : undefined;
      if (!h || !a) continue; // skip if a coach isn't linked

      h.pf += g.homePts;
      h.pa += g.awayPts;
      h.diff += g.homePts - g.awayPts;

      a.pf += g.awayPts;
      a.pa += g.homePts;
      a.diff += g.awayPts - g.homePts;

      if (g.homePts > g.awayPts) {
        h.w++;
        a.l++;
      } else if (g.homePts < g.awayPts) {
        a.w++;
        h.l++;
      } else {
        h.t++;
        a.t++;
      }
    }

    // sort: win% desc, then diff desc, then PF-PA desc
    const sorted = table.sort((x, y) => {
      const wx = x.w + x.l + x.t ? (x.w + 0.5 * x.t) / (x.w + x.l + x.t) : 0;
      const wy = y.w + y.l + y.t ? (y.w + 0.5 * y.t) / (y.w + y.l + y.t) : 0;
      if (wy !== wx) return wy - wx;
      if (y.diff !== x.diff) return y.diff - x.diff;
      return (y.pf - y.pa) - (x.pf - x.pa);
    });

    const lines = sorted.map(
      (r, i) =>
        `**${i + 1}. ${r.team}**  ${r.w}-${r.l}${r.t ? '-' + r.t : ''}  (PF ${r.pf} / PA ${r.pa} / Diff ${r.diff})`,
    );

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('DIC Standings')
          .setDescription(lines.join('\n') || 'No data')
          .setColor(0x3498db),
      ],
    });
  },
} as const;
