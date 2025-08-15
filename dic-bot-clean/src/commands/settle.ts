import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { settleWagersForGame } from '../lib/settle';
const prisma = new PrismaClient();

export const adminOnly = true;

export const command = {
  data: new SlashCommandBuilder()
    .setName('settle')
    .setDescription('Admin: settle wagers for a recorded game')
    .addIntegerOption(o => o.setName('game_id').setDescription('Game ID from DB').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    const gameId = interaction.options.getInteger('game_id', true);
    await interaction.deferReply({ ephemeral: true });

    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return interaction.editReply('Game not found.');
    if (game.homePts == null || game.awayPts == null) return interaction.editReply('Game has no final score yet.');

    await settleWagersForGame(gameId);
    await interaction.editReply(`✅ Settled wagers for Game ID ${gameId} (${game.homeTeam} vs ${game.awayTeam}).`);
  }
} as const;
