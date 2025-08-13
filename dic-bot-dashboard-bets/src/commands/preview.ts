import { SlashCommandBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { generatePreview } from "../lib/ai.js";
import { retrieveBanterForUsers } from "../lib/banter.js";
import type { SlashCommand } from "./_types.js";

const prisma = new PrismaClient();

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("preview")
    .setDescription("Generate a matchup preview vs another coach.")
    .addUserOption(o => o.setName("coach").setDescription("Opponent").setRequired(true)),
  async execute(interaction) {
    const oppUser = interaction.options.getUser("coach", true);
    const me = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    const opp = await prisma.coach.findUnique({ where: { discordId: oppUser.id } });
    if (!me?.team || !opp?.team) {
      await interaction.reply({ content: "Both coaches must run `/setteam` first.", ephemeral:true });
      return;
    }

    const recent = await prisma.game.findMany({
      where: { status: "confirmed", OR: [
        { homeCoachId: me.id, awayCoachId: opp.id },
        { homeCoachId: opp.id, awayCoachId: me.id }
      ]},
      orderBy: { playedAt: "desc" },
      take: 4
    });

    let meW=0, oppW=0;
    for (const g of recent) {
      if (g.homePts === null || g.awayPts === null) continue;
      const meIsHome = g.homeCoachId === me.id;
      const myPts = meIsHome ? g.homePts : g.awayPts;
      const theirPts = meIsHome ? g.awayPts : g.homePts;
      if (myPts > theirPts) meW++; else if (myPts < theirPts) oppW++;
    }

    const matchup = {
      me: { team: me.team, handle: me.handle },
      opp: { team: opp.team, handle: opp.handle },
      h2h_recent: `${meW}-${oppW}`,
    };

    const banter = await retrieveBanterForUsers([me.id, opp.id]);
    const cfg = await prisma.config.findFirst({ where: { id: 1 } });
    const text = await generatePreview({ matchup, lore: "", banter, spice: (cfg?.spiceLevel as any) || "pg13" });

    await interaction.reply(text.slice(0, 1800));
  }
}
