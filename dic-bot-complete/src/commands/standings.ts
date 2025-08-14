import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { computePower } from '../lib/power';
const prisma = new PrismaClient();
export const command = {
  data: new SlashCommandBuilder().setName('standings').setDescription('Show overall standings or power rankings')
    .addStringOption(o => o.setName('type').setDescription('overall | power').setRequired(false)),
  async execute(interaction: any) {
    const type = (interaction.options.getString('type') || 'overall').toLowerCase();
    if (type === 'power') {
      const rows = await computePower(prisma);
      const lines = rows.map((r, i) => `**${i+1}. ${r.team}** — PR ${r.composite} (Elo ${r.elo.toFixed(0)})`);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('DIC Power Rankings').setDescription(lines.join('\n')).setColor(0x16a085)] });
      return;
    }
    const teams = await prisma.coach.findMany();
    const games = await prisma.game.findMany({ where: { status: 'confirmed' } });
    type Rec = { id:number, team:string, w:number,l:number,t:number,pf:number,pa:number,diff:number };
    const table: Rec[] = teams.map(t => ({ id: t.id, team: t.team || t.handle, w:0,l:0,t:0,pf:0,pa:0,diff:0 }));
    const lookup = new Map<number, Rec>(table.map(r => [r.id, r]));
    for (const g of games) {
      if (g.homePts == null || g.awayPts == null) continue;
      const h = lookup.get(g.homeCoachId)!; const a = lookup.get(g.awayCoachId)!;
      h.pf += g.homePts; h.pa += g.awayPts; h.diff += g.homePts - g.awayPts;
      a.pf += g.awayPts; a.pa += g.homePts; a.diff += g.awayPts - g.homePts;
      if (g.homePts > g.awayPts) { h.w++; a.l++; } else if (g.homePts < g.awayPts) { a.w++; h.l++; } else { h.t++; a.t++; }
    }
    const sorted = table.sort((x,y) => {
      const wx = x.w + x.l + x.t ? (x.w + 0.5*x.t)/(x.w + x.l + x.t) : 0;
      const wy = y.w + y.l + y.t ? (y.w + 0.5*y.t)/(y.w + y.l + y.t) : 0;
      if (wy !== wx) return wy - wx;
      if (y.diff !== x.diff) return y.diff - x.diff;
      return (y.pf - y.pa) - (x.pf - x.pa);
    });
    const lines = sorted.map((r,i) => `**${i+1}. ${r.team}**  ${r.w}-${r.l}${r.t?'-'+r.t:''}  (PF ${r.pf} / PA ${r.pa} / Diff ${r.diff})`);
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('DIC Standings').setDescription(lines.join('\n')).setColor(0x3498db)] });
  }
} as const;
