import { SlashCommandBuilder } from 'discord.js';
export const command = {
  data: new SlashCommandBuilder()
    .setName('placebet')
    .setDescription('Place a bet (stub)')
    .addStringOption(o => o.setName('game').setDescription('Game id').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('DIC$ amount').setRequired(true)),
  async execute(interaction: any) {
    await interaction.reply({ content: 'Bet feature is coming soon.', ephemeral: true });
  }
} as const;
