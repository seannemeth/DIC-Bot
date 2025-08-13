import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import type { SlashCommand } from "./_types.js";

const prisma = new PrismaClient();

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("h2h")
    .setDescription("Head-to-head record vs another coach")
    .addUserOption(o => o.setName("coach").setDescription("Opponent").setRequired(true)),
  async execute(interaction) {
    const oppUser = interaction.options.getUser("coach", true);
    const me = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    const opp = await prisma.coach.findUnique({ where: { discordId: oppUser.id } });
    if (!me || !opp) {
      await interaction.reply({ content: "Both coaches must set up with `/setteam`.", ephemeral: true });
      return;
    }

    const games = await prisma.game.findMany({
      where: {
        status: "confirmed",
        OR: [
          { homeCoachId: me.id, awayCoachId: opp.id },
          { homeCoachId: opp.id, awayCoachId: me.id }
        ]
      },
      orderBy: { playedAt: "desc" }
    });

    let meW=0, oppW=0, ties=0, margins:number[] = [];
    for (const g of games) {
      if (g.homePts === null || g.awayPts === null) continue;
      const meIsHome = g.homeCoachId === me.id;
      const myPts = meIsHome ? g.homePts : g.awayPts;
      const theirPts = meIsHome ? g.awayPts : g.homePts;
      margins.push(myPts - theirPts);
      if (myPts > theirPts) meW++; else if (myPts < theirPts) oppW++; else ties++;
    }

    const last5 = games.slice(0,5).map(g => {
      const meIsHome = g.homeCoachId === me.id;
      const myPts = meIsHome ? g.homePts : g.awayPts;
      const theirPts = meIsHome ? g.awayPts : g.homePts;
      const label = myPts!>theirPts! ? "W" : (myPts!<theirPts! ? "L" : "T");
      return `${label} ${myPts}-${theirPts} (Week ${g.week})`;
    });

    const avgMargin = margins.length ? (margins.reduce((a,b)=>a+b,0)/margins.length).toFixed(1) : "0.0";
    const emb = new EmbedBuilder()
      .setTitle(`H2H: ${me.team || me.handle} vs ${opp.team || opp.handle}`)
      .setDescription(`All-time: **${meW}-${oppW}${ties?'-'+ties:''}**\nAvg margin: **${avgMargin}**\nLast 5: ${last5.join(" | ")}`)
      .setColor(0x9b59b6);

    await interaction.reply({ embeds:[emb] });
  }
}
