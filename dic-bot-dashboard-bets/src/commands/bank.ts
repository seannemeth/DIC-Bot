import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder().setName("bank").setDescription("Check your DIC$ balance & stipend"),
  async execute(interaction:any) {
    const me = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    if (!me) { await interaction.reply({ content: "Run `/setteam` first.", ephemeral:true }); return; }
    let wallet = await prisma.wallet.findUnique({ where: { coachId: me.id } });
    if (!wallet) wallet = await prisma.wallet.create({ data: { coachId: me.id, balance: 0 } });
    const emb = new EmbedBuilder().setTitle(`${me.team || me.handle} — Bank`).setDescription(`Balance: **DIC$ ${wallet.balance}**`).setColor(0x2ecc71);
    await interaction.reply({ embeds:[emb], ephemeral: true });
  }
} as const;
