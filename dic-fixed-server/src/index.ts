
import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  TextChannel,
  Interaction,
} from 'discord';
import { PrismaClient } from '@prisma/client';

import * as SetTeam from './commands/setteam';
import * as PostScore from './commands/postscore';
import * as Standings from './commands/standings';
import * as H2H from './commands/h2h';
import * as Preview from './commands/preview';
import * as Recap from './commands/recap';
import * as RoastMe from './commands/roastme';
import * as Admin from './commands/admin';
import * as AdminBank from './commands/admin-banking';
import * as AdminConf from './commands/adminconf';
import * as ConfStandings from './commands/confstandings';
import * as Bank from './commands/bank';
import * as Bet from './commands/bet';
import * as Leaderboard from './commands/leaderboard';
import * as Redeem from './commands/redeem';
import { startWebServer } from './web/server';

const prisma = new PrismaClient();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const commands = [
  SetTeam.command,
  PostScore.command,
  Standings.command,
  H2H.command,
  Preview.command,
  Recap.command,
  RoastMe.command,
  Admin.command,
  AdminBank.command,
  AdminConf.command,
  ConfStandings.command,
  Bank.command,
  Bet.command,
  Leaderboard.command,
  Redeem.command,
];

client.once(Events.ClientReady, async (c) => {
  console.log(`DIC bot logged in as ${c.user.tag}`);
  // Start web dashboard
  try {
    await startWebServer(prisma);
  } catch (e) {
    console.error('Failed to start web server', e);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      const cmd = commands.find((c) => c.data.name === name);
      if (!cmd) return;
      if (cmd.adminOnly && !interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: 'Admin only.', ephemeral: true });
        return;
      }
      await cmd.execute(interaction as any);
    } else if (interaction.isButton()) {
      const [kind, idStr] = interaction.customId.split(':');
      if (!idStr) return;
      const gameId = Number(idStr);
      const game = await prisma.game.findUnique({ where: { id: gameId } });
      if (!game) return;

      // Only opponent can confirm/dispute
      const clicker = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
      if (!clicker) { await interaction.reply({ content: 'You must /setteam first.', ephemeral: true }); return; }
      const isOpponent = (clicker.id === game.homeCoachId) || (clicker.id === game.awayCoachId);
      if (!isOpponent) { await interaction.reply({ content: 'Only participants can confirm/dispute.', ephemeral: true }); return; }

      if (kind === 'confirm') {
        await prisma.game.update({ where: { id: gameId }, data: { status: 'confirmed', confirmedById: clicker.id } });
        // Update message embed
        try {
          if (game.channelId && game.messageId) {
            const ch = await client.channels.fetch(game.channelId);
            if (ch && ch.type === ChannelType.GuildText) {
              const msg = await (ch as TextChannel).messages.fetch(game.messageId);
              await msg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setTitle(`Final • ${game.homeTeam} vs ${game.awayTeam}`)
                    .setDescription(`**${game.homeTeam} ${game.homePts}–${game.awayPts} ${game.awayTeam}**`)
                    .setColor(0x2ecc71),
                ],
                components: [],
              });
            }
          }
        } catch (e) {
          console.warn('Could not edit score message', e);
        }

        // ---- settle bets for this game/week ----
        try {
          const bets = await prisma.bet.findMany({ where: { season: game.season, week: game.week } });
          for (const b of bets) {
            if (b.status !== 'open') continue;
            if (b.gameId && b.gameId !== game.id) continue;
            // If bet isn't bound to gameId, we assume same week (already filtered). In production, store names on Bet.
            const snap = b.snapshotId ? await prisma.betLineSnapshot.findUnique({ where: { id: b.snapshotId } }) : null;
            const homePts = game.homePts ?? 0, awayPts = game.awayPts ?? 0;
            let outcome = 0; // 1 win, 0.5 push, 0 loss
            if (b.market === 'spread' && snap?.spread != null) {
              const spread = snap.spread;
              const margin = homePts - awayPts;
              if (b.side === 'home') {
                const adj = margin + spread;
                outcome = adj > 0 ? 1 : (adj === 0 ? 0.5 : 0);
              } else {
                const adj = -margin + spread;
                outcome = adj > 0 ? 1 : (adj === 0 ? 0.5 : 0);
              }
            } else if (b.market === 'total' && snap?.total != null) {
              const sum = homePts + awayPts;
              if (sum === snap.total) outcome = 0.5;
              else outcome = b.side === 'over' ? (sum > snap.total ? 1 : 0) : (sum < snap.total ? 1 : 0);
            } else if (b.market === 'ml') {
              if (homePts === awayPts) outcome = 0.5;
              else {
                const homeWon = homePts > awayPts;
                outcome = b.side === 'home' ? (homeWon ? 1 : 0) : (homeWon ? 0 : 1);
              }
            }
            let payout = 0;
            if (outcome === 1) {
              const price = b.price ?? -110;
              if (b.market === 'ml') {
                payout = price > 0 ? Math.floor(b.amount * (price/100)) : Math.floor(b.amount * (100/Math.abs(price)));
              } else {
                payout = Math.floor(b.amount * (100/110));
              }
              await prisma.wallet.update({ where: { coachId: b.coachId }, data: { balance: { increment: b.amount + payout }, lifetimeWon: { increment: payout } } });
              await prisma.bet.update({ where: { id: b.id }, data: { status: 'won', payout, settledAt: new Date() } });
            } else if (outcome === 0.5) {
              await prisma.wallet.update({ where: { coachId: b.coachId }, data: { balance: { increment: b.amount } } });
              await prisma.bet.update({ where: { id: b.id }, data: { status: 'push', payout: 0, settledAt: new Date() } });
            } else {
              await prisma.wallet.update({ where: { coachId: b.coachId }, data: { lifetimeLost: { increment: b.amount } } });
              await prisma.bet.update({ where: { id: b.id }, data: { status: 'lost', payout: -b.amount, settledAt: new Date() } });
            }
          }
        } catch (e) {
          console.error('Settlement error', e);
        }

        await interaction.reply({ content: 'Result confirmed. Standings updated.', ephemeral: true });
      }

      if (kind === 'dispute') {
        await prisma.game.update({ where: { id: gameId }, data: { status: 'disputed', confirmedById: null } });
        await interaction.reply({ content: 'Result marked as disputed. A mod will review.', ephemeral: true });
      }
    }
  } catch (err) {
    console.error('Interaction error', err);
    try { await (interaction as any).reply?.({ content: 'Something went wrong.', ephemeral: true }); } catch {}
  }
});

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('Missing DISCORD_TOKEN');
  await client.login(token);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
