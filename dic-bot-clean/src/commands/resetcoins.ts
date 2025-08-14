import { SlashCommandBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  adminOnly: true,
  data: new SlashCommandBuilder().setName('resetcoins').setDescription('Reset all wallets to 500 (admin)'),
  async execute(interaction: any) {
    if (!interaction.memberPermissions?.has('Administrator')) { await interaction.reply({ content:'Admin only.', ephemeral:true }); return; }
    const coaches = await prisma.coach.findMany(); let n=0;
    for (const c of coaches) {
      await prisma.wallet.upsert({ where:{ coachId:c.id }, update:{ balance:500 }, create:{ coachId:c.id, balance:500 } });
      n++;
    }
    await interaction.reply(`Reset ${n} wallets to DIC$ 500.`);
  }
} as const;
