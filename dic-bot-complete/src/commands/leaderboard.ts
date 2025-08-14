import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export const command = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Top DIC$ balances'),
  async execute(interaction: any) {
    const wallets = await prisma.wallet.findMany({ orderBy: { balance: 'desc' }, take: 10, include: { coach: true } });
    const lines = wallets.map((w, i) => `**${i+1}. ${w.coach.team || w.coach.handle}** — DIC$ ${w.balance}`);
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('DIC$ Leaderboard').setDescription(lines.join('\n') || 'No data').setColor(0x27ae60)] });
  }
} as const;
