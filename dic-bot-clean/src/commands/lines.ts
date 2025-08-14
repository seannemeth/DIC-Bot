import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
export const command = {
  data: new SlashCommandBuilder().setName('lines').setDescription('Show betting lines (stub)'),
  async execute(interaction: any) {
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Lines').setDescription('No lines yet.')] });
  }
} as const;
