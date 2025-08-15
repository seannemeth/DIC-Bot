// src/commands/inventory.ts
import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('See your purchased items'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const coach = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    if (!coach) return interaction.editReply('❌ You must set up first with `/setteam`.');

    const rows = await prisma.purchase.findMany({
      where: { coachId: coach.id },
      include: { item: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!rows.length) return interaction.editReply('Your inventory is empty.');

    const lines = rows.map((r: any) => {
      const left = r.qty - r.consumed;
      return `**${r.item.itemKey}** — ${r.item.name} • ${left}/${r.qty} left`;
    });

    const embed = new EmbedBuilder().setTitle('Your Inventory').setDescription(lines.join('\n')).setColor(0x9b59b6);
    return interaction.editReply({ embeds: [embed] });
  }
} as const;
