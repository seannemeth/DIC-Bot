// src/ingest/score-listener.ts
import { Client, EmbedBuilder, Message } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { getEmojiMap } from "./emoji-map";
import { getCurrentSeasonWeek } from "../lib/meta";
import { settleWagersForGame } from "../lib/settle";

const CUSTOM_EMOJI = /<a?:([a-zA-Z0-9_]+):(\d+)>/g;
const SCORE = /(\d{1,3})\s*[-–]\s*(\d{1,3})/;

function finalEmbed(g: {
  week: number;
  homeTeam: string;
  awayTeam: string;
  homePts: number;
  awayPts: number;
}) {
  const color =
    g.homePts > g.awayPts ? 0x2ecc71 : g.homePts < g.awayPts ? 0xe74c3c : 0x95a5a6;

  return new EmbedBuilder()
    .setTitle(`Week ${g.week}: ${g.homeTeam} vs ${g.awayTeam}`)
    .setDescription(
      `Final: **${g.homeTeam} ${g.homePts} – ${g.awayPts} ${g.awayTeam}**\n(Automatically confirmed)`
    )
    .setColor(color);
}

export function attachScoreListener(client: Client, prisma: PrismaClient) {
  const SCORES_CHANNEL_ID = process.env.SCORES_CHANNEL_ID || "";
  if (!SCORES_CHANNEL_ID) {
    console.warn("[scores-listener] SCORES_CHANNEL_ID not set; listener disabled.");
    return;
  }

  client.on("messageCreate", async (msg: Message) => {
    try {
      if (msg.author.bot || msg.channelId !== SCORES_CHANNEL_ID) return;

      const text = msg.content || "";

      // Must contain two custom emojis (home, away) and a score like "24-17"
      const emojis = Array.from(text.matchAll(CUSTOM_EMOJI)).map((m) => ({
        name: m[1],
        id: m[2],
      }));
      if (emojis.length < 2) return;

      const scoreMatch = text.match(SCORE);
      if (!scoreMatch) return;

      const s1 = Number(scoreMatch[1]);
      const s2 = Number(scoreMatch[2]);
      if (!Number.isFinite(s1) || !Number.isFinite(s2)) return;

      const map = await getEmojiMap();
      const e1 = emojis[0], e2 = emojis[1];
      const team1 = map[e1.id], team2 = map[e2.id];

      if (!team1 || !team2) {
        await msg.reply({
          content:
            "Couldn’t match both team emojis to teams. Update the **Emojis** tab.",
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      const { season, week } = await getCurrentSeasonWeek();
      const homeTeam = String(team1).trim();
      const awayTeam = String(team2).trim();
      const homePts = s1;
      const awayPts = s2;

      // Ensure both coaches exist for those teams
      const homeCoach = await prisma.coach.findFirst({
        where: { team: { equals: homeTeam, mode: "insensitive" } },
      });
      const awayCoach = await prisma.coach.findFirst({
        where: { team: { equals: awayTeam, mode: "insensitive" } },
      });

      if (!homeCoach || !awayCoach) {
        await msg.reply({
          content: "Both coaches must **/setteam** first.",
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      // Upsert the game for this Season/Week/Matchup, and AUTO-CONFIRM
      const game = await prisma.game.upsert({
        where: {
          season_week_homeTeam_awayTeam: {
            season,
            week,
            homeTeam,
            awayTeam,
          },
        },
        create: {
          season,
          week,
          homeTeam,
          awayTeam,
          homePts,
          awayPts,
          status: "confirmed" as any, // auto-confirm here
          homeCoachId: homeCoach.id,
          awayCoachId: awayCoach.id,
          reportedById: homeCoach.id,
          channelId: msg.channelId,
          messageId: undefined,
        },
        update: {
          homePts,
          awayPts,
          status: "confirmed" as any, // auto-confirm on update too
          homeCoachId: homeCoach.id,
          awayCoachId: awayCoach.id,
          reportedById: homeCoach.id,
          channelId: msg.channelId,
        },
      });

      // Announce the final result (no confirm/dispute buttons)
      const sent = await msg.reply({
        embeds: [
          finalEmbed({
            week,
            homeTeam,
            awayTeam,
            homePts,
            awayPts,
          }),
        ],
        allowedMentions: { repliedUser: false },
      });

      // Store message id for traceability (optional)
      await prisma.game.update({
        where: { id: game.id },
        data: { messageId: sent.id },
      });

      // Trigger settlement (best-effort)
      try {
        await settleWagersForGame(game.id);
      } catch (e) {
        console.error("[scores-listener] settle failed:", e);
      }
    } catch (e) {
      console.error("[scores-listener] error", e);
    }
  });
}
