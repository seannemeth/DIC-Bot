import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { getCurrentSeasonWeek } from '../lib/meta';

const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Show the schedule for a week (played vs remaining)')
    .addIntegerOption(o => o.setName('season').setDescription('Season').setRequired(false))
    .addIntegerOption(o => o.setName('week').setDescription('Week').setRequired(false))
    .addStringOption(o => o.setName('conference').setDescription('Filter by conference').setRequired(false))
    .addStringOption(o => o.setName('team').setDescription('Filter by team name').setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const meta = await getCurrentSeasonWeek();
    const season = interaction.options.getInteger('season') ?? meta.season ?? undefined;
    const week = interaction.options.getInteger('week') ?? meta.week ?? undefined;
    const conference = interaction.options.getString('conference')?.trim() || undefined;
    const team = interaction.options.getString('team')?.trim() || undefined;

    if (!season || !week) {
      return interaction.editReply('❌ Provide `season` and `week`, or set them via `/setweek`.');
    }

    const games = await prisma.game.findMany({
      where: { season, week },
      include: { homeCoach: true, awayCoach: true },
      orderBy: [{ playedAt: 'asc' }, { id: 'asc' }]
    });

    const filtered = games.filter(g => {
      if (conference && !(g.homeCoach.conference === conference || g.awayCoach.conference === conference)) return false;
      if (team && !(g.homeTeam === team || g.awayTeam === team)) return false;
      return true;
    });

    const played = filtered.filter(g => g.status === 'confirmed' && g.homePts != null && g.awayPts != null);
    const remaining = filtered.filter(g => !(g.status === 'confirmed' && g.homePts != null && g.awayPts != null));

    const fmt = (g: typeof filtered[number]) =>
      g.homePts != null && g.awayPts != null
        ? `**${g.homeTeam} ${g.homePts} – ${g.awayPts} ${g.awayTeam}**`
        : `${g.homeTeam} vs ${g.awayTeam}`;

    const embed = new EmbedBuilder()
      .setTitle(`DIC Schedule — S${season} W${week}${conference ? ` — ${conference}` : ''}${team ? ` — ${team}` : ''}`)
      .addFields(
        { name: `Played (${played.length})`, value: played.map(fmt).join('\n') || '—' },
        { name: `Remaining (${remaining.length})`, value: remaining.map(fmt).join('\n') || '—' },
      )
      .setColor(0x2ecc71);

    await interaction.editReply({ embeds: [embed] });
  }
} as const;
