import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Message } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { getEmojiMap } from "./emoji-map";

const CUSTOM_EMOJI = /<a?:([a-zA-Z0-9_]+):(\d+)>/g;
const SCORE = /(\d{1,3})\s*[-–]\s*(\d{1,3})/;

function pendingEmbed(g: any) {
  return new EmbedBuilder().setTitle(`Week ${g.week}: ${g.homeTeam} vs ${g.awayTeam}`)
    .setDescription(`Final (pending): **${g.homeTeam} ${g.homePts} – ${g.awayPts} ${g.awayTeam}**\nOpponent must confirm.`).setColor(0xf1c40f);
}

export function attachScoreListener(client: Client, prisma: PrismaClient) {
  const SCORES_CHANNEL_ID = process.env.SCORES_CHANNEL_ID || "";
  if (!SCORES_CHANNEL_ID) { console.warn("[scores-listener] SCORES_CHANNEL_ID not set; listener disabled."); return; }
  client.on("messageCreate", async (msg: Message) => {
    try {
      if (msg.author.bot || msg.channelId !== SCORES_CHANNEL_ID) return;
      const text = msg.content || "";
      const emojis = Array.from(text.matchAll(CUSTOM_EMOJI)).map(m => ({ name: m[1], id: m[2] }));
      if (emojis.length < 2) return;
      const scoreMatch = text.match(SCORE);
      if (!scoreMatch) return;
      const s1 = Number(scoreMatch[1]), s2 = Number(scoreMatch[2]);
      if (Number.isNaN(s1) || Number.isNaN(s2)) return;
      const map = await getEmojiMap();
      const e1 = emojis[0], e2 = emojis[1];
      const team1 = map[e1.id], team2 = map[e2.id];
      if (!team1 || !team2) { await msg.reply({ content: "Couldn’t match both team emojis to teams. Update the 'Emojis' tab.", allowedMentions:{ repliedUser:false } }); return; }
      const season = 1, week = 1;
      const homeTeam = team1, awayTeam = team2;
      const homePts = s1, awayPts = s2;
      const homeCoach = await prisma.coach.findFirst({ where:{ team:{ equals: homeTeam, mode:"insensitive" } } });
      const awayCoach = await prisma.coach.findFirst({ where:{ team:{ equals: awayTeam, mode:"insensitive" } } });
      if (!homeCoach || !awayCoach) { await msg.reply({ content:"Both coaches must /setteam first.", allowedMentions:{ repliedUser:false } }); return; }
      const game = await prisma.game.create({ data:{ season, week, homeCoachId:homeCoach.id, awayCoachId:awayCoach.id, homeTeam, awayTeam, homePts, awayPts, status:"pending", reportedById:homeCoach.id } });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`confirm:${game.id}`).setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`dispute:${game.id}`).setLabel("Dispute").setStyle(ButtonStyle.Danger)
      );
      const sent = await msg.reply({ embeds: [pendingEmbed(game)], components: [row], allowedMentions:{ repliedUser:false } });
      await prisma.game.update({ where:{ id: game.id }, data:{ messageId: sent.id, channelId: sent.channelId } });
    } catch (e) { console.error("[scores-listener] error", e); }
  });
}
