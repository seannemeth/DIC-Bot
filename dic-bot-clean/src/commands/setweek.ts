import { SlashCommandBuilder, type ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { setNumber } from '../lib/meta';

export const command = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('setweek')
    .setDescription('Set the current season/week used by other commands')
    .addIntegerOption(o => o.setName('season').setDescription('Season').setRequired(true))
    .addIntegerOption(o => o.setName('week').setDescription('Week').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction: ChatInputCommandInteraction) {
    const season = interaction.options.getInteger('season', true);
    const week = interaction.options.getInteger('week', true);
    await setNumber('currentSeason', season);
    await setNumber('currentWeek', week);
    await interaction.reply({ content: `✅ Set current season=${season}, week=${week}.`, ephemeral: true });
  }
} as const;
