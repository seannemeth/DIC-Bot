import { SlashCommandBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { generateRoast } from "../lib/ai.js";
import { retrieveBanterForUsers } from "../lib/banter.js";
import type { SlashCommand } from "./_types.js";

const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder().setName("roastme").setDescription("PG→R roast (gameplay-focused)."),
  async execute(interaction:any) {
    const me = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    if (!me) { await interaction.reply({ content: "Run `/setteam` first.", ephemeral: true }); return; }
    const banter = await retrieveBanterForUsers([me.id]);
    const cfg = await prisma.config.findFirst({ where: { id: 1 } });
    const text = await generateRoast({ targetHandle: me.handle, context: `${me.team}`, banter, spice: (cfg?.spiceLevel as any) || "pg13" });
    await interaction.reply(text.slice(0, 1800));
  }
} as const;
