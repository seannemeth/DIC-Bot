import { SlashCommandBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import type { SlashCommand } from "./_types.js";

const prisma = new PrismaClient();

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("setteam")
    .setDescription("Bind your Discord user to a team.")
    .addStringOption(o => o.setName("team").setDescription("Team name (e.g., Penn State)").setRequired(true))
    .addStringOption(o => o.setName("conference").setDescription("Conference name").setRequired(false)),
  async execute(interaction) {
    const team = interaction.options.getString("team", true);
    const conference = interaction.options.getString("conference") || undefined;
    const discordId = interaction.user.id;
    const handle = `${interaction.user.username}`;

    const existing = await prisma.coach.findUnique({ where: { discordId } });
    if (existing) {
      await prisma.coach.update({ where: { discordId }, data: { team, conference, handle } });
    } else {
      await prisma.coach.create({ data: { discordId, handle, team, conference } });
    }
    await interaction.reply({ content: `Team set: **${team}** ${conference ? `(${conference})` : ""}`, ephemeral: true });
  }
}
