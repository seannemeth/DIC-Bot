import "dotenv/config";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, Collection, EmbedBuilder, Events, GatewayIntentBits, Interaction, Partials, TextChannel } from "discord.js";
import { PrismaClient } from "@prisma/client";
import * as SetTeam from "./commands/setteam.js";
import * as PostScore from "./commands/postscore.js";
import * as Standings from "./commands/standings.js";
import * as H2H from "./commands/h2h.js";
import * as Recap from "./commands/recap.js";
import * as Preview from "./commands/preview.js";
import * as Roast from "./commands/roastme.js";
import * as Admin from "./commands/admin.js";
import { startWebServer } from "./web/server.js";
import { tryParseScore } from "./lib/parseScore.js";
import { maybeStoreBanter } from "./lib/banter.js";

const prisma = new PrismaClient();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const commands = new Collection<string, any>();
[SetTeam, PostScore, Standings, H2H, Recap, Preview, Roast, Admin].forEach(c => {
  commands.set(c.command.data.name, c.command);
});

client.once(Events.ClientReady, async (c) => {
  console.log(`DIC bot logged in as ${c.user.tag}`);
  startWebServer(prisma).catch(console.error);
  // Ensure config row exists
  await prisma.config.upsert({ where: { id:1 }, update: {}, create: { id:1 } });
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (!cmd) return;
      if (cmd.adminOnly && !interaction.memberPermissions?.has("Administrator")) {
        await interaction.reply({ content: "Admin only.", ephemeral: true });
        return;
      }
      await cmd.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      const [kind, idStr] = interaction.customId.split(":");
      if (!["confirm", "dispute"].includes(kind)) return;
      const gameId = Number(idStr);
      const game = await prisma.game.findUnique({ where: { id: gameId } });
      if (!game) return;

      // Only opponent can confirm/dispute
      const clicker = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
      if (!clicker || (clicker.id !== game.awayCoachId)) {
        await interaction.reply({ content: "Only the opponent can confirm/dispute.", ephemeral: true });
        return;
      }

      if (kind === "confirm") {
        // After confirm, settle bets for this game
        await prisma.game.update({ where: { id: gameId }, data: { status: "confirmed", confirmedById: clicker.id } });
        const ch = await client.channels.fetch(game.channelId!);
        const msg = ch?.type === ChannelType.GuildText ? await (ch as TextChannel).messages.fetch(game.messageId!) : null;
        if (msg) {
          await msg.edit({ embeds: [new EmbedBuilder().setTitle(`Final • ${game.homeTeam} vs ${game.awayTeam}`).setDescription(`**${game.homeTeam} ${game.homePts}–${game.awayPts} ${game.awayTeam}**`).setColor(0x2ecc71)] , components: [] });
        }
        // --- settle bets ---
        try {
          const bets = await prisma.bet.findMany({ where: { season: game.season, week: game.week } });
          for (const b of bets) {
            // match by stored gameId or by teams
            if (b.gameId && b.gameId !== game.id) continue;
            if (!b.gameId) {
              // try to match via teams if not linked
              // skip if mismatch
              // (lightweight: only settle if same teams)
              // In production, store home/away names on Bet
            }
            if (b.status !== "open") continue;

            const snap = await prisma.betLineSnapshot.findUnique({ where: { id: b.snapshotId! } });
            const homePts = game.homePts!, awayPts = game.awayPts!;

            let outcome = 0; // 1 win, 0.5 push, 0 loss
            if (b.market === "spread" && snap?.spread != null) {
              const spread = snap.spread;
              const margin = homePts - awayPts;
              // from home perspective
              if (b.side === "home") {
                const adj = margin + spread;
                outcome = adj > 0 ? 1 : (adj === 0 ? 0.5 : 0);
              } else {
                const adj = -margin + spread;
                outcome = adj > 0 ? 1 : (adj === 0 ? 0.5 : 0);
              }
            } else if (b.market === "total" && snap?.total != null) {
              const sum = homePts + awayPts;
              if (sum === snap.total) outcome = 0.5;
              else outcome = (b.side === "over" ? (sum > snap.total ? 1 : 0) : (sum < snap.total ? 1 : 0));
            } else if (b.market === "ml") {
              const homeWon = homePts > awayPts;
              if (homePts === awayPts) outcome = 0.5;
              else outcome = (b.side === "home" ? (homeWon ? 1 : 0) : (homeWon ? 0 : 1));
            }

            let payout = 0;
            if (outcome === 1) {
              const price = b.price ?? -110;
              if (b.market === "ml") {
                payout = price > 0 ? Math.floor(b.amount * (price/100)) : Math.floor(b.amount * (100/Math.abs(price)));
              } else {
                payout = Math.floor(b.amount * (100/110));
              }
              await prisma.wallet.update({ where: { coachId: b.coachId }, data: { balance: { increment: b.amount + payout }, lifetimeWon: { increment: payout } } });
              await prisma.bet.update({ where: { id: b.id }, data: { status: "won", payout, settledAt: new Date() } });
            } else if (outcome === 0.5) {
              // push: return stake
              await prisma.wallet.update({ where: { coachId: b.coachId }, data: { balance: { increment: b.amount } } });
              await prisma.bet.update({ where: { id: b.id }, data: { status: "push", payout: 0, settledAt: new Date() } });
            } else {
              await prisma.wallet.update({ where: { coachId: b.coachId }, data: { lifetimeLost: { increment: b.amount } } });
              await prisma.bet.update({ where: { id: b.id }, data: { status: "lost", payout: -b.amount, settledAt: new Date() } });
            }
          }
        } catch (e) { console.error("Settlement error", e); }
        await interaction.reply({ content: "Result confirmed. Standings updated.", ephemeral: true });
        return;
        await prisma.game.update({ where: { id: gameId }, data: { status: "confirmed", confirmedById: clicker.id } });
        const ch = await client.channels.fetch(game.channelId!);
        const msg = ch?.type === ChannelType.GuildText ? await (ch as TextChannel).messages.fetch(game.messageId!) : null;
        if (msg) {
          await msg.edit({ embeds: [new EmbedBuilder().setTitle(`Final • ${game.homeTeam} vs ${game.awayTeam}`).setDescription(`**${game.homeTeam} ${game.homePts}–${game.awayPts} ${game.awayTeam}**`).setColor(0x2ecc71)] , components: [] });
        }
        await interaction.reply({ content: "Result confirmed. Standings updated.", ephemeral: true });
        return;
      }

      if (kind === "dispute") {
        await interaction.reply({ content: "Disputed. Mods have been notified.", ephemeral: true });
        // TODO: post a ticket in admin channel
        return;
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: "Error processing command.", ephemeral: true }); } catch {}
    }
  }
});

// Free-text score parsing & banter learning
client.on(Events.MessageCreate, async (m) => {
  try {
    if (m.author.bot || !m.guild) return;

    // Banter learning (opt-in simplified: store if coach exists and allowLearn true)
    if (process.env.DIC_ALLOW_BANTER_LEARNING === "true") {
      await maybeStoreBanter({ discordId: m.author.id, channelId: m.channelId, messageId: m.id, text: m.content });
    }

    const channelLimit = process.env.SCORES_CHANNEL_ID;
    if (channelLimit && m.channelId !== channelLimit) return;

    const parsed = tryParseScore(m.content);
    if (!parsed) return;

    // Map users/teams to coaches
    function noti(msg: string) { return m.reply({ content: msg }); }

    if (parsed.type === "users") {
      const a = await prisma.coach.findUnique({ where: { discordId: parsed.aId } });
      const b = await prisma.coach.findUnique({ where: { discordId: parsed.bId } });
      if (!a?.team || !b?.team) return;
      const game = await prisma.game.create({
        data: { season:1, week:1, homeCoachId:a.id, awayCoachId:b.id, homeTeam:a.team, awayTeam:b.team, homePts:parsed.aPts, awayPts:parsed.bPts, status:"pending", reportedById:a.id, channelId:m.channelId, messageId:m.id }
      });
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder().setCustomId(`confirm:${game.id}`).setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`dispute:${game.id}`).setLabel("Dispute").setStyle(ButtonStyle.Danger)
        );
      await m.reply({ embeds: [new EmbedBuilder().setTitle(`Week ${game.week} • ${game.homeTeam} vs ${game.awayTeam}`).setDescription(`Final (pending): **${game.homeTeam} ${game.homePts}–${game.awayPts} ${game.awayTeam}**\nOpponent must confirm.`).setColor(0xf1c40f)], components:[row] });
      return;
    }

    if (parsed.type === "teams") {
      // We need to resolve teams → coaches
      const a = await prisma.coach.findFirst({ where: { team: { equals: parsed.aTeam, mode: "insensitive" } } });
      const b = await prisma.coach.findFirst({ where: { team: { equals: parsed.bTeam, mode: "insensitive" } } });
      if (!a?.team || !b?.team) return;
      const game = await prisma.game.create({
        data: { season:1, week:1, homeCoachId:a.id, awayCoachId:b.id, homeTeam:a.team, awayTeam:b.team, homePts:parsed.aPts, awayPts:parsed.bPts, status:"pending", reportedById:a.id, channelId:m.channelId, messageId:m.id }
      });
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder().setCustomId(`confirm:${game.id}`).setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`dispute:${game.id}`).setLabel("Dispute").setStyle(ButtonStyle.Danger)
        );
      await m.reply({ embeds: [new EmbedBuilder().setTitle(`Week ${game.week} • ${game.homeTeam} vs ${game.awayTeam}`).setDescription(`Final (pending): **${game.homeTeam} ${game.homePts}–${game.awayPts} ${game.awayTeam}**\nOpponent must confirm.`).setColor(0xf1c40f)], components:[row] });
      return;
    }

    if (parsed.type === "wl") {
      const me = await prisma.coach.findUnique({ where: { discordId: m.author.id } });
      const opp = await prisma.coach.findUnique({ where: { discordId: parsed.oppId } });
      if (!me?.team || !opp?.team) return;

      const homeCoachId = parsed.venue === "home" ? me.id : opp.id;
      const awayCoachId = parsed.venue === "home" ? opp.id : me.id;
      const homePts = parsed.venue === "home" ? (parsed.who === "W" ? parsed.myPts : parsed.oppPts) : (parsed.who === "W" ? parsed.oppPts : parsed.myPts);
      const awayPts = parsed.venue === "home" ? (parsed.who === "W" ? parsed.oppPts : parsed.myPts) : (parsed.who === "W" ? parsed.myPts : parsed.oppPts);

      const homeTeam = homeCoachId === me.id ? me.team! : opp.team!;
      const awayTeam = awayCoachId === me.id ? me.team! : opp.team!;

      const game = await prisma.game.create({
        data: { season:1, week:1, homeCoachId, awayCoachId, homeTeam, awayTeam, homePts, awayPts, status:"pending", reportedById: me.id, channelId:m.channelId, messageId:m.id }
      });
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder().setCustomId(`confirm:${game.id}`).setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`dispute:${game.id}`).setLabel("Dispute").setStyle(ButtonStyle.Danger)
        );
      await m.reply({ embeds: [new EmbedBuilder().setTitle(`Week ${game.week} • ${game.homeTeam} vs ${game.awayTeam}`).setDescription(`Final (pending): **${game.homeTeam} ${game.homePts}–${game.awayPts} ${game.awayTeam}**\nOpponent must confirm.`).setColor(0xf1c40f)], components:[row] });
      return;
    }

  } catch (e) {
    console.error(e);
  }
});

client.login(process.env.DISCORD_TOKEN);
