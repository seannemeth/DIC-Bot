import { SlashCommandBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { generateRecap } from "../lib/ai.js";
import { retrieveBanterForUsers } from "../lib/banter.js";
import type { SlashCommand } from "./_types.js";

const prisma = new PrismaClient();

export const command: SlashCommand = {
  data: new SlashCommandBuilder().setName("recap").setDescription("Generate an AI recap for your last confirmed game."),
  async execute(interaction) {
    const me = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    if (!me) { await interaction.reply({ content: "Run `/setteam` first.", ephemeral: true }); return; }

    const game = await prisma.game.findFirst({
      where: { status: "confirmed", OR: [{ homeCoachId: me.id }, { awayCoachId: me.id }] },
      orderBy: { playedAt: "desc" }
    });
    if (!game) { await interaction.reply({ content: "No confirmed games found.", ephemeral:true }); return; }

    const meIsHome = game.homeCoachId === me.id;
    const oppId = meIsHome ? game.awayCoachId : game.homeCoachId;
    const opp = await prisma.coach.findUnique({ where: { id: oppId } });

    const facts = {
      home: { team: game.homeTeam, coachId: game.homeCoachId, pts: game.homePts },
      away: { team: game.awayTeam, coachId: game.awayCoachId, pts: game.awayPts },
      week: game.week, season: game.season
    };

    const banter = await retrieveBanterForUsers([me.id, oppId]);
    const cfg = await prisma.config.findFirst({ where: { id: 1 } });
    const text = await generateRecap({
      facts, lore: "", banter, spice: (cfg?.spiceLevel as any) || "pg13"
    });

    await interaction.reply(text.slice(0, 1800)); // Discord limit safety
  }
}
