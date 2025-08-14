import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { computePower } from '../lib/power';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder().setName('power').setDescription('DIC Power Rankings'),
  async execute(interaction: any) {
    const rows = await computePower(prisma);
    const top = rows.slice(0, 25);
    const lines = top.map((r:any, i:number) => `**${i+1}. ${r.team}** — PR ${r.composite} (Elo ${r.elo.toFixed(0)})`);
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('DIC Power Rankings').setDescription(lines.join('\n') || 'No games yet').setColor(0x16a085)] });
  }
} as const;
