import { SlashCommandBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Check your DIC$ balance'),
  async execute(interaction: any) {
    const me = await prisma.coach.findUnique({ where:{ discordId: interaction.user.id } });
    if (!me) { await interaction.reply({ content:'Run /setteam first.', ephemeral:true }); return; }
    const w = await prisma.wallet.upsert({ where:{ coachId: me.id }, update:{}, create:{ coachId: me.id, balance: 500 } });
    await interaction.reply({ content: `Your balance: DIC$ ${w.balance}`, ephemeral: true });
  }
} as const;
