// src/commands/schedule.ts
import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getWeekSchedule } from '../lib/schedule';

export const command = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Show the week schedule: remaining and played')
    .addIntegerOption(o => o.setName('season').setDescription('Season').setRequired(true))
    .addIntegerOption(o => o.setName('week').setDescription('Week').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const season = interaction.options.getInteger('season', true);
    const week = interaction.options.getInteger('week', true);

    const { played, remaining } = await getWeekSchedule(season, week);

    const lines = (arr: any[]) => arr.length
      ? arr.map(g => g.status === 'confirmed'
          ? `✅ **${g.homeTeam} ${g.homePts} — ${g.awayTeam} ${g.awayPts}**`
          : `⏳ ${g.homeTeam} vs ${g.awayTeam}`).join('\n')
      : '_None_';

    const embed = new EmbedBuilder()
      .setTitle(`Season ${season} — Week ${week} Schedule`)
      .addFields(
        { name: `Remaining (${remaining.length})`, value: lines(remaining) },
        { name: `Played (${played.length})`, value: lines(played) },
      );

    await interaction.editReply({ embeds: [embed] });
  },
} as const;
