import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, SlashCommandBuilder, TextChannel } from "discord.js";
import { PrismaClient } from "@prisma/client";
import type { SlashCommand } from "./_types.js";

const prisma = new PrismaClient();

function pendingEmbed(game: any) {
  return new EmbedBuilder()
    .setTitle(`Week ${game.week} • ${game.homeTeam} vs ${game.awayTeam}`)
    .setDescription(`Final (pending): **${game.homeTeam} ${game.homePts}–${game.awayPts} ${game.awayTeam}**\nOpponent must confirm.`)
    .setColor(0xf1c40f);
}

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("postscore")
    .setDescription("Log a game result and request opponent confirmation.")
    .addIntegerOption(o => o.setName("my").setDescription("Your points").setRequired(true))
    .addIntegerOption(o => o.setName("opp").setDescription("Opponent points").setRequired(true))
    .addUserOption(o => o.setName("opp_user").setDescription("Opponent Discord user").setRequired(true))
    .addIntegerOption(o => o.setName("week").setDescription("Week (defaults to current)").setRequired(false))
    .addIntegerOption(o => o.setName("season").setDescription("Season (defaults to 1)").setRequired(false)),
  async execute(interaction) {
    const myPts = interaction.options.getInteger("my", true);
    const oppPts = interaction.options.getInteger("opp", true);
    const oppUser = interaction.options.getUser("opp_user", true);
    const week = interaction.options.getInteger("week") ?? 1;
    const season = interaction.options.getInteger("season") ?? 1;

    const me = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    const opp = await prisma.coach.findUnique({ where: { discordId: oppUser.id } });
    if (!me?.team || !opp?.team) {
      await interaction.reply({ content: "Both coaches must run `/setteam` first.", ephemeral: true });
      return;
    }

    // Decide home/away (simple: first arg is reporter's team as home by default)
    const homeCoachId = me.id;
    const awayCoachId = opp.id;
    const homeTeam = me.team;
    const awayTeam = opp.team;
    const homePts = myPts, awayPts = oppPts;

    // Create pending game
    const game = await prisma.game.create({
      data: { season, week, homeCoachId, awayCoachId, homeTeam, awayTeam, homePts, awayPts, status: "pending", reportedById: me.id }
    });

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder().setCustomId(`confirm:${game.id}`).setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`dispute:${game.id}`).setLabel("Dispute").setStyle(ButtonStyle.Danger)
      );

    // Send to scores channel if configured, else reply in-place
    const targetChannelId = process.env.SCORES_CHANNEL_ID;
    let sent;
    if (targetChannelId) {
      const ch = await interaction.client.channels.fetch(targetChannelId);
      if (ch && ch.type === ChannelType.GuildText) {
        sent = await (ch as TextChannel).send({ embeds: [pendingEmbed(game)], components: [row] });
      }
    }
    if (!sent) {
      sent = await interaction.reply({ embeds: [pendingEmbed(game)], components: [row], fetchReply: true });
    }

    // Save message
    await prisma.game.update({ where: { id: game.id }, data: { messageId: sent.id, channelId: sent.channelId } });
  }
}
