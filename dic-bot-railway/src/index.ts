import "dotenv/config";
import { Client, Collection, Events, GatewayIntentBits, Interaction, TextChannel, ChannelType, EmbedBuilder, ButtonStyle, ButtonBuilder, ActionRowBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import * as SetTeam from "./commands/setteam.js";
import * * as PostScore from "./commands/postscore.js";
import * as Standings from "./commands/standings.js";
import * as H2H from "./commands/h2h.js";
import * as Recap from "./commands/recap.js";
import * as Preview from "./commands/preview.js";
import * as Roastme from "./commands/roastme.js";
import * as Admin from "./commands/admin.js";
import * as AdminBank from "./commands/admin-banking.js";
import * as AdminConf from "./commands/adminconf.js";
import * as ConfStandings from "./commands/confstandings.js";
import * as Bank from "./commands/bank.js";
import * as Bet from "./commands/bet.js";
import * as Leaderboard from "./commands/leaderboard.js";
import * as Redeem from "./commands/redeem.js";
import { startWebServer } from "./web/server.js";

const prisma = new PrismaClient();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
});

type Command = { data:any, execute:(i:any)=>Promise<void>, adminOnly?:boolean };
const registry: Record<string, Command> = {};
[
  SetTeam, PostScore, Standings, H2H, Recap, Preview, Roastme,
  Admin, AdminBank, AdminConf, ConfStandings, Bank, Bet, Leaderboard, Redeem
].forEach((mod:any)=> { registry[mod.command.data.name] = mod.command; });

client.once(Events.ClientReady, async (c) => {
  console.log(`DIC bot logged in as ${c.user.tag}`);
  startWebServer(prisma).catch(console.error);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // Buttons: confirm/dispute scores settlement hook
  if (interaction.isButton()) {
    const [kind, idStr] = interaction.customId.split(":");
    if ((kind === "confirm" || kind === "dispute") && idStr) {
      const gameId = parseInt(idStr, 10);
      const game = await prisma.game.findUnique({ where: { id: gameId } });
      if (!game) { await interaction.reply({ content: "Game not found.", ephemeral:true }); return; }
      const clicker = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
      if (!clicker) { await interaction.reply({ content:"Run /setteam first.", ephemeral:true }); return; }
      if (kind === "dispute") {
        await prisma.game.update({ where: { id: gameId }, data: { status: "pending" } });
        await interaction.reply({ content: "Flagged for dispute. A mod will review.", ephemeral: true });
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
            if (b.gameId && b.gameId !== game.id) continue;
            if (b.status !== "open") continue;
            const snap = b.snapshotId ? await prisma.betLineSnapshot.findUnique({ where: { id: b.snapshotId } }) : null;
            const homePts = game.homePts!, awayPts = game.awayPts!;
            let outcome = 0; // 1 win, 0.5 push, 0 loss
            if (b.market === "spread" && snap?.spread != null) {
              const spread = snap.spread;
              const margin = homePts - awayPts;
              if (b.side === "home") {
                const adj = margin + spread!;
                outcome = adj > 0 ? 1 : (adj === 0 ? 0.5 : 0);
              } else {
                const adj = -margin + spread!;
                outcome = adj > 0 ? 1 : (adj === 0 ? 0.5 : 0);
              }
            } else if (b.market === "total" && snap?.total != null) {
              const sum = homePts + awayPts;
              if (sum === snap.total) outcome = 0.5;
              else outcome = (b.side === "over" ? (sum > (snap.total!)) : (sum < (snap.total!))) ? 1 : 0;
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
      }
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const cmd = registry[interaction.commandName];
    if (!cmd) return;
    if (cmd.adminOnly && !interaction.memberPermissions?.has("Administrator")) {
      await interaction.reply({ content: "Admin only.", ephemeral: true });
      return;
    }
    try {
      await cmd.execute(interaction as any);
    } catch (e) {
      console.error(e);
      if (interaction.deferred || interaction.replied) await (interaction as any).followUp({ content: "Error.", ephemeral:true });
      else await interaction.reply({ content: "Error.", ephemeral:true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
