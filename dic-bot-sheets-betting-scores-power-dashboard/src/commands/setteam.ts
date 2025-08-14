import { SlashCommandBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export const command = {
  data: new SlashCommandBuilder()
    .setName('setteam')
    .setDescription('Link your Discord account to a team')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true))
    .addStringOption(o => o.setName('conference').setDescription('Conference').setRequired(false)),
  async execute(interaction: any) {
    const team = interaction.options.getString('team', true);
    const conference = interaction.options.getString('conference') || undefined;
    const discordId = interaction.user.id;
    const handle = interaction.user.username;
    const existing = await prisma.coach.findUnique({ where: { discordId } });
    if (existing) await prisma.coach.update({ where: { discordId }, data: { team, conference, handle } });
    else await prisma.coach.create({ data: { discordId, handle, team, conference } });
    await interaction.reply({ content: `Linked to **${team}** ${conference ? '('+conference+')' : ''}`, ephemeral: true });
  }
} as const;
