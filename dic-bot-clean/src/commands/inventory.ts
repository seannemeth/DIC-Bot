import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder().setName('inventory').setDescription('Your purchased items'),
  async execute(interaction:any){
    const coach = await prisma.coach.findUnique({ where:{ discordId: interaction.user.id } });
    if (!coach) { await interaction.reply({ content:'Run /setteam first.', ephemeral:true }); return; }
    const purchases = await prisma.purchase.findMany({ where:{ coachId: coach.id }, include:{ item:true }, orderBy:{ purchasedAt:'desc' } });
    const lines = purchases.map(p => `• ${p.item.name} — DIC$ ${p.price} *(on ${p.purchasedAt.toISOString().slice(0,10)})*`);
    const embed = new EmbedBuilder().setTitle('🎒 Your Inventory').setDescription(lines.join('\n') || '_Empty_');
    await interaction.reply({ embeds:[embed], ephemeral:true });
  }
} as const;
