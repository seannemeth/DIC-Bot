import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a purchased item')
    .addStringOption(o => o.setName('item').setDescription('Item key').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const coach = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    if (!coach) return interaction.editReply('❌ You must set up first with `/setteam`.');

    const itemKey = interaction.options.getString('item', true);
    const item = await prisma.item.findUnique({ where: { itemKey } });
    if (!item) return interaction.editReply('❌ Item not found.');

    const all = await prisma.purchase.findMany({ where: { coachId: coach.id, itemId: item.itemKey } });
    const usable = all.find((p: any) => !p.consumedAt);
    if (!usable) return interaction.editReply('❌ You do not have any unused copies of that item.');

    await prisma.purchase.update({
      where: { id: usable.id },
      data: { consumedAt: new Date() },
    });

    return interaction.editReply(`✅ Redeemed **${item.name}**.`);
  }
} as const;
